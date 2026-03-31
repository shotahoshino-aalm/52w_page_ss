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
      '--disable-features=IsolateOrigins,site-per-process' // iframeの別プロセス化を防ぐ
    ]
  });
  const page = await browser.newPage();
  
  // スマホ(iPhone 13)の表示をエミュレート
  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています...');
  // タイムアウトを60秒に設定し、DOMの読み込み完了を待機
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log('全画像を読み込ませるため、一番下まで自動スクロールします...');
  // ページ内を自動でスクロールする処理（Lazy Load対策）
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

  console.log('不要なポップアップの削除と、YouTubeの画像置換を行っています...');
  // 画面内の特定の要素を操作する処理
  await page.evaluate(() => {
    // 1. 指定された追従バナーを削除
    const banners = document.querySelectorAll('.fixation-bnr');
    banners.forEach(el => el.remove());

    // 2. YouTubeのiframeをサムネイル画像に強制置換（白抜き対策）
    const iframes = document.querySelectorAll('iframe[src*="youtube.com/embed/"]');
    iframes.forEach(iframe => {
      const src = iframe.src;
      // URLから動画IDを抽出 (例: .../embed/YS7LsILZ9qA?rel=0 -> YS7LsILZ9qA)
      const videoIdMatch = src.match(/embed\/([a-zA-Z0-9_-]+)/);
      
      if (videoIdMatch && videoIdMatch[1]) {
        const videoId = videoIdMatch[1];
        // YouTube公式の高画質サムネイル画像URL
        const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        
        // iframeと同じサイズの画像要素(img)を新しく作成
        const img = document.createElement('img');
        img.src = thumbUrl;
        
        // 元のiframeのスタイルに合わせて表示を整える
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.aspectRatio = '16 / 9'; // YouTubeの標準比率
        img.style.objectFit = 'cover';
        
        // HTML上で iframe を 作成した img にすり替える
        iframe.parentNode.replaceChild(img, iframe);
      }
    });
  });

  console.log('最終的な描画が落ち着くまで5秒待機します...');
  // サムネイル画像の読み込みや描画が終わるのを確実に待つ
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('スクリーンショットを取得中...');
  // fullPage: true でページ全体を撮影
  const screenshotBuffer = await page.screenshot({ fullPage: true });
  await browser.close();

  console.log('Google Drive(共有ドライブ)へアップロードしています...');
  // Google Drive APIの認証設定
  const auth = new google.auth.GoogleAuth({
    credentials: credentialsJson,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const drive = google.drive({ version: 'v3', auth });
  
  // バッファをストリームに変換
  const bufferStream = new stream.PassThrough();
  bufferStream.end(screenshotBuffer);

  // ファイル名（例: screenshot_2024-03-31.png）
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
      supportsAllDrives: true, // ★共有ドライブへの保存に必須
    });
    console.log(`アップロード完了！ File ID: ${res.data.id}`);
  } catch (err) {
    console.error('アップロードに失敗しました:', err);
  }
}

run();
