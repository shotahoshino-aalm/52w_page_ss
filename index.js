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

  console.log('DOMの整理とコンテンツの読み込み（3段階スクロール）を開始します...');
  await page.evaluate(async () => {
    // 1. バナー削除
    document.querySelectorAll('.fixation-bnr').forEach(el => el.remove());

    // 2. is-within（今週の表示）が付与されるのを待つ (最大5秒)
    for(let i=0; i<10; i++) {
      if (document.querySelector('.is-within')) break;
      await new Promise(r => setTimeout(r, 500));
    }

    // 3. 期間外のブロックを削除
    document.querySelectorAll('.js-date-check').forEach(el => {
      if (!el.classList.contains('is-within')) el.remove();
    });

    // 4. 【第1段階】通信を誘発させるための「下見スクロール」
    await new Promise((resolve) => {
      let totalHeight = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 500);
        totalHeight += 500;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });

    // 5. 【第2段階】タグの中にデータ(HTML)が入るのを待つ (最大15秒)
    for(let i=0; i<30; i++) {
      const tags = document.querySelectorAll('.js-3ple-tag-to-content');
      let allDone = true;
      tags.forEach(tag => {
        // 文字数が少ない、かつ子要素がない場合は未完了とみなす
        if (tag.innerHTML.trim().length < 50 && tag.children.length === 0) {
          allDone = false;
        }
      });
      // タグがすべて完了したか、処理によってタグ自体が消滅した場合はループを抜ける
      if (tags.length === 0 || allDone) break; 
      await new Promise(r => setTimeout(r, 500));
    }

    // 6. 【第3段階】追加されたコンテンツ内の画像を読み込ませるため、上に戻ってから「仕上げスクロール」
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 1000));
    await new Promise((resolve) => {
      let totalHeight = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 400);
        totalHeight += 400;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
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
      console.log('YouTube置換スキップ:', err.message);
    }
  }

  console.log('一番上に戻り、最終的なレイアウト安定を3秒待機します...');
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
