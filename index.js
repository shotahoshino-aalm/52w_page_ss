const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const stream = require('stream');

async function run() {
  const url = 'https://www.3ple.jp/feature/3ple/ichioshi52w/';
  const folderId = process.env.DRIVE_FOLDER_ID;
  const gasUrl = process.env.GAS_URL;

  console.log('ブラウザを起動しています...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=IsolateOrigins,site-per-process']
  });
  
  const page = await browser.newPage();
  
  // ★【対策1】サーバーの時差ボケを直し、日本時間（JST）を強制的にエミュレートする
  await page.emulateTimezone('Asia/Tokyo');
  
  // キャッシュを無効化（古いデータが残るのを防ぐ）
  await page.setCacheEnabled(false);

  // スマホ(iPhone 13)の表示をエミュレート
  const iPhone = puppeteer.KnownDevices['iPhone 13'];
  await page.emulate(iPhone);

  console.log('ページにアクセスしています...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log('一番下まで自動スクロールします...');
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

  console.log('不要な要素の削除と、表示期間外のコンテンツをパージしています...');
  await page.evaluate(() => {
    // 1. バナー削除
    const banners = document.querySelectorAll('.fixation-bnr');
    banners.forEach(el => el.remove());

    // ★【対策2】「is-within(期間内)」クラスを持たない過去・未来のブロックをHTMLごと完全に削除
    const dateChecks = document.querySelectorAll('.js-date-check');
    dateChecks.forEach(el => {
      if (!el.classList.contains('is-within')) {
        el.remove(); 
      }
    });
  });

  console.log('最新のYouTube枠を画像化しています...');
  // 期間外の動画は削除済みなので、ここには「今週の動画」だけが残っている
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
      console.log('YouTube置換エラー:', err.message);
    }
  }

  console.log('一番上に戻り、最終的な描画を待機します...');
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('スクリーンショットを取得中...');
  const screenshotBuffer = await page.screenshot({ fullPage: true });
  await browser.close();

  console.log('GAS経由でGoogle Driveへアップロードしています...');
  const base64Data = screenshotBuffer.toString('base64');
  const dateStr = new Date().toISOString().split('T')[0];
  const fileName = `screenshot_${dateStr}.png`;

  try {
    const response = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderId: folderId,
        fileName: fileName,
        mimeType: 'image/png',
        fileData: base64Data
      })
    });
    
    const result = await response.json();
    if (result.success) {
      console.log(`アップロード完了！ File ID: ${result.id}`);
    } else {
      console.error('GAS側でエラーが発生しました:', result.error);
    }
  } catch (err) {
    console.error('通信エラー:', err);
  }
}

run();
