const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const stream = require('stream');

async function run() {
  const url = 'https://www.3ple.jp/feature/3ple/ichioshi52w/';
  const folderId = process.env.DRIVE_FOLDER_ID;
  const credentialsJson = JSON.parse(process.env.GCP_SA_KEY);

  console.log('ブラウザを起動しています...');
  const browser = await puppeteer.launch({
    headless: true, // 最新版Puppeteerの標準指定
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-features=IsolateOrigins,site-per-process' 
    ]
  });
  
  const page = await browser.newPage();

  // ★★★【追加】ブラウザ内部のエラーをGitHub Actionsのログに筒抜けにする監視カメラ ★★★
  page.on('console', msg => console.log('[サイト内ログ]:', msg.text()));
  page.on('pageerror', error => console.error('[サイト内JSエラー]:', error.message));
  page.on('requestfailed', request => {
    console.error(`[通信ブロック/失敗]: ${request.url()} - ${request.failure()?.errorText}`);
  });
  // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★

  // Bot回避
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['ja', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });
  await page.emulateTimezone('Asia/Tokyo');
  await page.setCacheEnabled(false);

  // スマホ環境の再現（iPhone 13）
  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています...');
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  } catch (err) {
    console.warn('※ページ遷移時エラー:', err.message);
  }

  console.log('API通信を誘発させるため、一番下までゆっくりスクロールします...');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });

  console.log('画面に表示されているAPIデータ（タグ）の到着を待機します...');
  await page.evaluate(async () => {
    document.querySelectorAll('.fixation-bnr').forEach(el => el.remove());

    await new Promise((resolve) => {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        const tags = document.querySelectorAll('.js-3ple-tag-to-content');
        
        let allVisibleLoaded = true;
        let visibleCount = 0;

        tags.forEach(tag => {
          if (tag.offsetParent !== null) {
            visibleCount++;
            if (tag.innerHTML.trim().length < 50) {
              allVisibleLoaded = false;
            }
          }
        });

        if ((visibleCount > 0 && allVisibleLoaded) || attempts >= 40) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });

  console.log('最新のYouTube枠を画像化しています...');
  const iframes = await page.$$('iframe[src*="youtube.com/embed/"]');
  for (const iframe of iframes) {
    try {
      const isVisible = await iframe.evaluate(el => el.offsetParent !== null);
      if (!isVisible) {
        await iframe.evaluate(el => el.remove());
        continue;
      }
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

  console.log('一番上に戻り、最終的なレイアウト安定を待機します...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 3000));

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
