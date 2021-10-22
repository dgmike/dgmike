const util = require('util')
const Cosmic = require('cosmicjs');
const ejs = require('ejs');
const dayjs = require('dayjs');
const fsExtra = require('fs-extra');

const debugLogger = util.debug('app');

const formatDate = (dateString) =>
  dayjs(dateString).format('DD/HH/YYYY');

const api = Cosmic();
const bucket = api.bucket({
  slug: 'dgmike-production',
  read_key: 'LZcRbZJk49r12ljjHaLH6dZZT3idoErDhz9fftszeF9Qy18JxO',
});

const getSettings = async () => {
  const {
    object: {
      metadata: { configurations },
    },
  } = await bucket.getObject({
    id: '6172faa111e9500009ad8cb7',
    props: 'metadata.configurations'
  });
  return configurations.reduce((acc, {key, value}) => ({ ...acc, [key]: value }), {});
}

const getArticles = ({ limit = 100, skip = 0, props = 'slug,title,metadata.headline,published_at,locale' } = {}) =>{
  const params = {
    query: { type: 'articles', locale: 'pt-BR' },
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
  const params = { limit, skip, props: 'id,slug,title,published_at,content' }
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
  };
  debugLogger(util.inspect(homePageParams, null, Infinity));

  const dirStructure = [
    'dist',
    'dist/pages',
  ];

  await Promise.all(dirStructure.map(dir => fsExtra.mkdirp(dir)));

  await fsExtra.ensureSymlink('static', 'dist/static')

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
    };
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
