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
  
  // Bot回避
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['ja', 'en-US', 'en'] });
  });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8' });
  await page.emulateTimezone('Asia/Tokyo');
  await page.setCacheEnabled(false);

  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています...');
  try {
    // 完全に読み込むとVWOが邪魔をするため、骨組み(DOM)ができたら即座に次へ進む
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {}

  console.log('【重要】A/Bテストツールによる画面隠蔽を強制解除し、今週のコンテンツを強制表示します...');
  await page.evaluate(() => {
    // 1. VWOが仕掛けた「画面を透明にする」CSSを強制破壊し、可視化する
    document.body.style.setProperty('opacity', '1', 'important');
    document.body.style.setProperty('display', 'block', 'important');
    const vwoHide = document.getElementById('_vis_opt_path_hides');
    if (vwoHide) vwoHide.remove();

    // 2. サイトのJSに頼らず、自分たちで日付を計算して今週の枠を強制表示する
    const now = new Date();
    document.querySelectorAll('.js-date-check').forEach(el => {
      const startStr = el.getAttribute('data-start');
      const endStr = el.getAttribute('data-end');
      if (startStr && endStr) {
        const start = new Date(startStr);
        const end = new Date(endStr);
        if (now >= start && now <= end) {
          el.classList.add('is-within');
          el.style.display = 'block';
          el.style.opacity = '1';
          el.style.visibility = 'visible';
        } else {
          el.remove(); // 期間外は完全に削除
        }
      }
    });

    // 3. 固定バナー削除
    document.querySelectorAll('.fixation-bnr').forEach(el => el.remove());
  });

  // スクロール処理を関数化（後で2回使うため）
  const smoothScroll = async () => {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 300);
          totalHeight += 300;
          
          // 強制的にスクロールイベントを発火（サイト側のJSを叩き起こす）
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
          if (typeof jQuery !== 'undefined') jQuery(window).trigger('scroll');

          if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
      });
    });
  };

  console.log('第1段階：API通信(タグのデータ取得)を誘発するためスクロールします...');
  await smoothScroll();

  console.log('APIの通信完了を待機しています...');
  try {
    // 「ネットワーク通信が完全に落ち着く」まで待つ最強の待機メソッド
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 15000 });
  } catch (e) {
    console.log('※通信待機タイムアウト（処理は継続します）');
  }

  console.log('第2段階：追加されたデータ内の画像(LazyLoad)を表示するため、再スクロールします...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 1000));
  await smoothScroll();

  console.log('画像のロード完了を待機しています...');
  try {
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 });
  } catch (e) {}

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
    } catch (err) {}
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
