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
  
  // スマホ(iPhone 13)の表示をエミュレート
  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log('全画像を読み込ませるため、一番下まで自動スクロールします...');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300; // 1回にスクロールするピクセル数
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        // ページの一番下に到達したら終了（ここではまだ上に戻さない）
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
  // ページ上のYouTubeのiframe要素をすべて取得
  const iframes = await page.$$('iframe[src*="youtube.com/embed/"]');
  for (const iframe of iframes) {
    try {
      // 該当のYouTube動画が画面内に見える位置までスクロール
      await iframe.scrollIntoView();
      // プレイヤーのUI（タイトルやボタン等）が描画されるのを2秒待機
      await new Promise(r => setTimeout(r, 2000));
      
      // ★iframe部分だけをスクリーンショット撮影し、Base64の画像データにする
      const base64Img = await iframe.screenshot({ encoding: 'base64' });
      
      // 撮影した画像を、HTML上の元のiframe要素とすり替える
      await page.evaluate((frameEl, base64) => {
        const img = document.createElement('img');
        img.src = 'data:image/png;base64,' + base64;
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.display = 'block'; // 不要な余白を防止
        frameEl.parentNode.replaceChild(img, frameEl);
      }, iframe, base64Img);
    } catch (err) {
      console.log('YouTube置換エラー（スキップします）:', err.message);
    }
  }

  console.log('一番上に戻り、最終的な描画を待機します...');
  // スクリーンショット撮影前にページの一番上に戻す
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
