const util = require('util')
const Cosmic = require('cosmicjs');
const ejs = require('ejs');
const dayjs = require('dayjs');
const fsExtra = require('fs-extra');

const debugLogger = util.debug('app');

const formatDate = (dateString) =>
  dayjs(dateString).format('DD/HH/YYYY');

const env = {
  BASE_URL: process.env.BASE_URL || '',
  BUCKET_SLUG: process.env.BUCKET_SLUG || '',
  BUCKET_KEY: process.env.BUCKET_KEY || '',
  BUCKET_SETTINGS_ID: process.env.BUCKET_SETTINGS_ID || '',
  CERT_FILE: process.env.CERT_FILE || 'cert',
  CERT_VALUE: process.env.CERT_VALUE || '',
};

const api = Cosmic();
const bucket = api.bucket({
  slug: env.BUCKET_SLUG,
  read_key: env.BUCKET_KEY,
});

const getSettings = async () => {
  const {
    object: {
      metadata: { configurations },
    },
  } = await bucket.getObject({
    id: env.BUCKET_SETTINGS_ID,
    props: 'metadata.configurations'
  });
  return configurations.reduce((acc, {key, value}) => ({ ...acc, [key]: value }), {});
}

const getArticles = ({ limit = 100, skip = 0, props = 'slug,title,metadata.headline,published_at,locale' } = {}) =>{
  const params = {
    query: { type: 'articles' },
    props,
    sort: '-created_at',
    limit,
    skip,
    use_cache: false,
  }
  return bucket.getObjects(params);
}

const getMostRecentArticles = () => getArticles({ limit: 10 })

const runOnPages = async (fn, { limit = 1, skip = 0 } = {}) => {
  const params = { limit, skip, props: 'id,slug,title,thumbnail,metadata.headline,published_at,content' }
  const data = await getArticles(params);
  data.objects.forEach(fn);
  if ((data.skip || 0) + data.limit < data.total)
    return runOnPages(fn, { limit, skip: skip + limit });
}

const run = async () => {
  const siteSettings = await getSettings();
  const mostRecentArticles = await getMostRecentArticles();
  const homePageParams = {
    siteSettings,
    mostRecentArticles,
    formatDate,
    env,
    page: 'home',
  };
  debugLogger(util.inspect(homePageParams, null, Infinity));

  const dirStructure = [
    'dist',
    'dist/pages',
    'dist/.well-known/acme-challenge/',
  ];

  await fsExtra.outputFile('dist/.nojekyll', '');

  console.info(`creating certificate file on dist/.well-known/acme-challenge/${env.CERT_FILE}`)
  await fsExtra.outputFile(`dist/.well-known/acme-challenge/${env.CERT_FILE}`, env.CERT_VALUE);

  await Promise.all(dirStructure.map(dir => fsExtra.mkdirp(dir)));

  await fsExtra.copy('static', 'dist/static')

  const homePageContent = await ejs.renderFile(`${__dirname}/templates/index.ejs`, homePageParams);
  const homePagePath = 'dist/index.html';
  debugLogger(homePagePath);
  debugLogger(homePageContent);
  await fsExtra.outputFile(homePagePath, homePageContent);

  await runOnPages(async (page) => {
    const pageParams = {
      siteSettings,
      mostRecentArticles,
      page,
      formatDate,
      env,
    };
    console.info({ pageParams })
    await fsExtra.mkdirp(`dist/pages/${page.slug}`);
    const pageContent = await ejs.renderFile(`${__dirname}/templates/page.ejs`, pageParams);
    const pagePath = `dist/pages/${page.slug}/index.html`;
    debugLogger(pagePath);
    debugLogger(pageContent);
    await fsExtra.outputFile(pagePath, pageContent);
  })
}

run()
  .catch(console.error);
