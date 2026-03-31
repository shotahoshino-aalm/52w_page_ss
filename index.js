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
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています...');
  // 60秒の余裕を持たせてアクセス
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log('全画像を読み込ませるため、一番下まで自動スクロールします...');
  // ページ内を自動でスクロールする処理
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300; // 1回にスクロールするピクセル数
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        // ページの一番下に到達したら終了
        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0); // スクショ前に一番上に戻す
          resolve();
        }
      }, 150); // 0.15秒ごとにスクロール
    });
  });

  console.log('不要なポップアップやバナーを削除しています...');
  // 画面内の特定の要素を削除する処理
  await page.evaluate(() => {
    // 1. 指定いただいたバナーを削除
    const banners = document.querySelectorAll('.fixation-bnr');
    banners.forEach(el => el.remove());

    // 2. もし他に「白っぽいフタ」の原因となるローディング要素があれば削除
    // ※今回は全要素に対して、z-indexが異常に高い(ポップアップ系)ものを非表示にする保険をかけます
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.zIndex > 100) {
        // el.remove(); // やりすぎると必要なものも消えるので、まずはバナー指定削除のみで様子見
      }
    });
  });

  console.log('最終的な描画が落ち着くまで5秒待機します...');
  // 読み込みやアニメーションが終わるのを確実に待つ
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('スクリーンショットを取得中...');
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
