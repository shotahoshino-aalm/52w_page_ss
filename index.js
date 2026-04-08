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
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-application-cache' // ★追加：ブラウザのアプリケーションキャッシュを無効化
    ]
  });
  const page = await browser.newPage();

  // ★追加：ページレベルでのキャッシュを完全に無効化
  await page.setCacheEnabled(false);

  // ★追加：サーバー（CDNやYouTube）側に「キャッシュを寄越さないで」と強制するヘッダー
  await page.setExtraHTTPHeaders({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  
  // スマホ(iPhone 13)の表示をエミュレート
  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています（キャッシュ無効）...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log('全画像を読み込ませるため、一番下まで自動スクロールします...');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150); 
    });
  });

  console.log('不要なポップアップを削除しています...');
  await page.evaluate(() => {
    const banners = document.querySelectorAll('.fixation-bnr');
    banners.forEach(el => el.remove());
  });

  console.log('YouTube枠をそのままの見た目で画像化しています...');
  // ページ上のYouTubeのiframe要素をすべて取得（隠れている古いものも含まれる）
  const iframes = await page.$$('iframe[src*="youtube.com/embed/"]');
  
  for (const iframe of iframes) {
    try {
      // ★【追加】このiframeが現在「表示」されているか（今週のCMか）を判定
      const isVisible = await page.evaluate((el) => {
        // 幅や高さが0、または display: none 等で隠されているかチェック
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }, iframe);

      // ★【追加】もし非表示（過去や未来のCM）なら、画面から完全に削除してスキップ
      if (!isVisible) {
        await page.evaluate(el => el.remove(), iframe);
        console.log('非表示の古いYouTube枠を削除しました');
        continue; // 次の要素へ
      }

      // 以下、表示されている（今週の）YouTube枠だけを画像化する処理
      await iframe.scrollIntoView();
      await new Promise(r => setTimeout(r, 2000)); // 読み込み待機
      
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

  console.log('一番上に戻り、最終的な描画を待機します...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 3000));

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
