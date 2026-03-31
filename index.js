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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log('全画像を読み込ませるため、一番下まで自動スクロールします...');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400; // 少し広めにスクロール
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200); // YouTubeが反応しやすいように少しゆっくり(0.2秒)スクロール
    });
  });

  console.log('YouTubeなどの外部通信が完全に終わるまで待機しています...');
  try {
    // ネットワークの通信が「2秒間」完全に静かになるまで待つ（最大15秒）
    await page.waitForNetworkIdle({ idleTime: 2000, timeout: 15000 });
  } catch (e) {
    console.log('一部の通信が継続中ですが、タイムアウトしたため次へ進みます。');
  }

  console.log('不要なポップアップやバナーを削除し、上部に戻ります...');
  await page.evaluate(() => {
    // 通信完了後に一番上へ戻す
    window.scrollTo(0, 0);

    // バナーの削除
    const banners = document.querySelectorAll('.fixation-bnr');
    banners.forEach(el => el.remove());
  });

  console.log('最終的な描画が落ち着くまで3秒待機します...');
  await new Promise(resolve => setTimeout(resolve, 3000));

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
