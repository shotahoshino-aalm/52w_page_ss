const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const stream = require('stream');

async function run() {
  const url = 'https://www.3ple.jp/feature/3ple/ichioshi52w/';
  const folderId = process.env.DRIVE_FOLDER_ID;
  // GitHub Secretsに登録したGCPサービスアカウントのJSONキー
  const credentialsJson = JSON.parse(process.env.GCP_SA_KEY);

  console.log('ブラウザを起動しています...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-features=IsolateOrigins,site-per-process' // iframeの白抜き対策
    ]
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
  
  console.log('一番下まで自動スクロールします（Lazy Load対策）...');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300; 
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        // 一番下に到達したら終了
        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
