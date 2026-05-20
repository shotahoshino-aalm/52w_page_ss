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
  
  // Bot検知（Access Denied）回避の偽装工作
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['ja', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });
  await page.emulateTimezone('Asia/Tokyo');
  await page.setCacheEnabled(false);

  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています...');
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  } catch (err) {
    console.warn('※ページ遷移時にエラーが発生しましたが、処理を継続します:', err.message);
  }

  console.log('初期JSの実行を待機しています...');
  await new Promise(r => setTimeout(r, 5000));

console.log('不要なブロックの削除と、APIデータ(タグ)の到着を待機しています...');
  await page.evaluate(async () => {
    // 1. スクショの邪魔になる固定バナーを削除
    document.querySelectorAll('.fixation-bnr').forEach(el => el.remove());

    // ★追加対策1: サイト側の処理（is-withinの付与）が確実に終わるのを待つ
    await new Promise(resolve => {
      let checkAttempts = 0;
      const checkTimer = setInterval(() => {
        checkAttempts++;
        // .is-withinを持つ要素が現れるか、5秒経過したら次へ
        if (document.querySelector('.is-within') || checkAttempts >= 10) {
          clearInterval(checkTimer);
          resolve();
        }
      }, 500);
    });

    // 2. 期間外のブロックをHTMLごと完全に削除
    document.querySelectorAll('.js-date-check').forEach(el => {
      if (!el.classList.contains('is-within')) {
        el.remove(); 
      }
    });

    // 3. 有効なタグコンテナ(.js-3ple-tag-to-content)にデータが挿入されるまで監視
    await new Promise((resolve) => {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        const tagContainers = document.querySelectorAll('.js-3ple-tag-to-content');
        
        // ★追加対策2: コンテナが「0個」の場合は、まだサイトが生成中とみなして待機する
        let allLoaded = tagContainers.length > 0; 
        
        tagContainers.forEach(container => {
          // 中身の文字数が10文字以下（空っぽか、ローディングタグのみ）ならまだと判定
          if (container.innerHTML.trim().length < 10) {
            allLoaded = false;
          }
        });

        // 全てにデータが入ったか、20秒(40回)経過したら次へ進む
        if (allLoaded || attempts >= 40) {
          clearInterval(timer);
          resolve();
        }
      }, 500); 
    });
  });

  console.log('取得したデータ内の画像を読み込ませるため、ゆっくりスクロールします...');
  try {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 400;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          
          if (totalHeight >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 400); 
      });
    });
  } catch (err) {
    console.warn('スクロールエラー:', err.message);
  }

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
      console.log('YouTube置換スキップ:', err.message);
    }
  }

  console.log('一番上に戻り、最終的なレイアウト安定を5秒待機します...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('全体のスクリーンショットを取得中...');
  const screenshotBuffer = await page.screenshot({ fullPage: true });
  await browser.close();

  console.log('Google Driveへアップロードしています...');
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
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: 'image/png', body: bufferStream },
      supportsAllDrives: true,
    });
    console.log(`アップロード完了！ File ID: ${res.data.id}`);
  } catch (err) {
    console.error('アップロードに失敗しました:', err);
  }
}

run();
