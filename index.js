const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const stream = require('stream');

async function run() {
  const url = 'https://www.3ple.jp/feature/3ple/ichioshi52w/';
  const folderId = process.env.DRIVE_FOLDER_ID;
  const credentialsJson = JSON.parse(process.env.GCP_SA_KEY);

  console.log('ブラウザを起動しています...');
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // スマホ(iPhone 13)の表示をエミュレート
  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています...');
  // ページが完全に読み込まれるまで待機
  await page.goto(url, { waitUntil: 'networkidle2' });
  
  console.log('スクリーンショットを取得中...');
  // fullPage: true でページ全体を撮影し、メモリ（バッファ）に一時保存
  const screenshotBuffer = await page.screenshot({ fullPage: true });
  await browser.close();

  console.log('Google Driveへアップロードしています...');
  // Google Drive APIの認証設定
  const auth = new google.auth.GoogleAuth({
    credentials: credentialsJson,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const drive = google.drive({ version: 'v3', auth });
  
  // バッファをストリームに変換
  const bufferStream = new stream.PassThrough();
  bufferStream.end(screenshotBuffer);

  // ファイル名（例: screenshot_2023-10-25.png）
  const dateStr = new Date().toISOString().split('T')[0];
  const fileName = `screenshot_${dateStr}.png`;

  try {
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId], // 指定したフォルダに保存
      },
      media: {
        mimeType: 'image/png',
        body: bufferStream,
      },
    });
    console.log(`アップロード完了！ File ID: ${res.data.id}`);
  } catch (err) {
    console.error('アップロードに失敗しました:', err);
  }
}

run();
