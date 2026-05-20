const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const stream = require('stream');

async function run() {
  const url = 'https://www.3ple.jp/feature/3ple/ichioshi52w/';
  const folderId = process.env.DRIVE_FOLDER_ID;
  const credentialsJson = JSON.parse(process.env.GCP_SA_KEY);

  console.log('ブラウザを起動しています...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-features=IsolateOrigins,site-per-process' 
    ]
  });
  
  const page = await browser.newPage();
  
  // サーバーの時差ボケを直し、日本時間（JST）を強制的にエミュレートする
  await page.emulateTimezone('Asia/Tokyo');
  await page.setCacheEnabled(false);

  // スマホ(iPhone 13)の表示をエミュレート
  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています...');
  try {
    // CSS等が確実に読み込まれる 'load' を使用
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  } catch (err) {
    console.warn('※ページ遷移時にエラーが発生しましたが、処理を継続します:', err.message);
  }

  console.log('初期JSの反映を5秒待機しています...');
  await new Promise(r => setTimeout(r, 5000));
  
  console.log('JSコンテンツの生成を待つため、監視型スクロールを実行します...');
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 400; // 1回のスクロール量
        let lastScrollHeight = document.body.scrollHeight;
        let unchangedCount = 0;
        
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          
          const currentScrollHeight = document.body.scrollHeight;
          
          // 一番下（付近）まで到達したかチェック
          if (totalHeight >= currentScrollHeight - window.innerHeight) {
            // ★JSによるコンテンツ追加で「ページの高さ」が変わったか監視
            if (currentScrollHeight === lastScrollHeight) {
              unchangedCount++;
              // 約4秒間（400ms × 10回）新しいタグの追加がなければ、全読み込み完了とみなす
              if (unchangedCount >= 10) {
                clearInterval(timer);
                resolve();
              }
            } else {
              // 高さが伸びた（JSでタグ等が追加された）場合はカウントをリセットしてスクロール継続
              lastScrollHeight = currentScrollHeight;
              unchangedCount = 0;
            }
          }
        }, 400); 
      });
    });
  } catch (err) {
    console.warn('※スクロール中にページ構造が変化しましたが、継続します:', err.message);
  }

  // ★追加：生成されたJSコンテンツの中身（画像やテキスト）が完全に描画されるのを待つ
  console.log('タグコンテンツが完全に描画されるまでさらに10秒待機します...');
  await new Promise(r => setTimeout(r, 10000));

  console.log('不要な要素の削除と、表示期間外のコンテンツをパージしています...');
  await page.evaluate(() => {
    // 追従バナーを削除
    const banners = document.querySelectorAll('.fixation-bnr');
    banners.forEach(el => el.remove());

    // 期間外のブロックをHTMLごと完全に削除
    const dateChecks = document.querySelectorAll('.js-date-check');
    dateChecks.forEach(el => {
      if (!el.classList.contains('is-within')) {
        el.remove(); 
      }
    });
  });

  console.log('最新のYouTube枠を画像化しています...');
  const iframes = await page.$$('iframe[src*="youtube.com/embed/"]');
  for (const iframe of iframes) {
    try {
      await iframe.scrollIntoView();
      await new Promise(r => setTimeout(r, 2000));
      
      const base64Img = await iframe.screenshot({ encoding: 'base64' });
      await page.evaluate((frameEl, base64) => {
        const img = document.createElement('img');
        img.src = 'data:image/png;base64,' + base64;
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        frameEl.parentNode.replaceChild(img, frameEl);
      }, iframe, base64Img);
    } catch (err) {
      console.log('YouTube置換エラー（スキップします）:', err.message);
    }
  }

  console.log('一番上に戻り、最終的なレイアウト安定を5秒待機します...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('全体のスクリーンショットを取得中...');
  const screenshotBuffer = await page.screenshot({ fullPage: true });
  await browser.close();

  console.log('Google Drive(共有ドライブ)へアップロードしています...');
  const auth = new google.auth.GoogleAuth({
    credentials: credentialsJson,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const drive = google.drive({ version: 'v3', auth });
  
  const bufferStream = new stream.PassThrough();
  bufferStream.end(screenshotBuffer);

  const dateStr = new Date().toISOString().split('T')[0];
  const fileName = `screenshot_${dateStr}.png`;

  try {
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId], 
      },
      media: {
        mimeType: 'image/png',
        body: bufferStream,
      },
      supportsAllDrives: true,
    });
    console.log(`アップロード完了！ File ID: ${res.data.id}`);
  } catch (err) {
    console.error('アップロードに失敗しました:', err);
  }
}

run();
