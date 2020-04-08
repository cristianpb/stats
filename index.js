const axios = require("axios");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

config = {
  token: process.env['TRAFFIC_API_GITHUB_TOKEN'],
  username: 'cristianpb',
  showRateLimit: true
}

axios.defaults.baseURL = "https://api.github.com";
axios.defaults.headers.common["Accept"] = "application/vnd.github.v3+json";

if (config.token) {
  axios.defaults.headers.common["Authorization"] = `token ${config.token}`;
}

const parseLinkHeader = response => {
  const linkHeader = response.headers["link"];
  if (!linkHeader) {
    return [];
  }
  return linkHeader
    .split(",")
    .map(link => link.split(";").map(s => s.trim()))
    .map(([hrefPart, relPart]) => {
      const href = /^<([^>]+)>$/.exec(hrefPart)[1];
      const rel = /^rel="([^"]+)"$/.exec(relPart)[1];
      return { href, rel };
    });
};

const getPages = async (url, config) => {
  const response = await axios.get(url, config);
  const rels = parseLinkHeader(response);
  const next = rels.find(rel => rel.rel === "next");
  if (next) {
    return [response.data, ...await getPages(next.href, config)];
  }
  else {
    return [response.data];
  }
};

const displayRateLimitData = async () => {
  const rateLimitResponse = await axios.get("/rate_limit");
  const rateLimitData = rateLimitResponse.data;
  console.log(`rate limit: ${rateLimitData.resources.core.limit}`);
  console.log(`rate remaining: ${rateLimitData.resources.core.remaining}`);
  console.log(`rate reset: ${new Date(rateLimitData.resources.core.reset * 1000)}`);
};

const handleError = err => {
  if (err.response) {
    const response = err.response;
    const request = response.request;
    const status = response.status;
    const statusText = response.statusText;
    if (response.data && response.data.message) {
      console.log(`[${request.method} ${request.path}] status: ${status}; statusText: ${statusText}; message: ${response.data.message}`);
    }
    else {
      console.log(`[${request.method} ${request.path}] status: ${status}; statusText: ${statusText}; err: ${err}`);
    }
  }
  else {
    if (err.config) {
      console.log(`[${err.config.method} ${err.config.url}] err: ${err}`);
    }
    else {
      console.log(`err: ${err}`);
    }
  }
};

const flatten = arrs =>
  [].concat(...arrs);

const asyncWrapper = async () => {
  try {
    if (config.showRateLimit) {
      await displayRateLimitData();
    }
    const url = `/users/${config.username}/repos`;
    const configPages = {
      params: {
        "per_page": config.pageSize
      }
    };
    const repos = flatten(await getPages(url, configPages));

    process.stdout.write(`${"-".repeat(repos.length)}\n`);

    let results = [];
    const repositories = [];
    let indent = 0;
    for (let index = 0; index < repos.length; index++) {
      try {
        const repo = repos[index];
        const viewsPromise = axios.get(`/repos/${repo.owner.login}/${repo.name}/traffic/views`);
        const clonesPromise = axios.get(`/repos/${repo.owner.login}/${repo.name}/traffic/clones`);
        const [{ data: views }, { data: clones }] = await Promise.all([viewsPromise, clonesPromise]);

        process.stdout.write(`${repo.name}\n`);

        const dataRepo = { 
          nomRepo: repo.name,
          url: repo.html_url,
          updated: repo.updated_at,
          size: repo.size,
          stars: repo.stargazers_count,
          watchers: repo.watchers_count,
          forks: repo.forks,
          views: views.count,
          viewsUniques: views.uniques,
          clones: clones.count,
          clonesUniques: clones.uniques,
        }
        
        const visits = {}
        clones.clones.forEach(item => {
          if (!(visits[item.timestamp.substring(0,10)])) visits[item.timestamp.substring(0,10)] = {}
          visits[item.timestamp.substring(0,10)].clones = item.count
        })
        views.views.forEach(item => {
            if (!(visits[item.timestamp.substring(0,10)])) visits[item.timestamp.substring(0,10)] = {}
            visits[item.timestamp.substring(0,10)].views = item.count
        })

        const dataWrite = Object.keys(visits).map(key => {
          return {
            date: key,
            repository: repo.name,
            views: visits[key].views ?  visits[key].views : 0,
            clones: visits[key].clones ?  visits[key].clones : 0
          }
        })

        if (Object.values(dataWrite).length > 0) {
          repositories.push(dataRepo);
          let joinArray = results.concat(dataWrite);
          results = joinArray
        }
        indent++;
      }
      catch (err) {
        indent && process.stdout.write("\n");
        indent = 0;
        handleError(err);
      }
    }

    process.stdout.write("\n");

    const csvWriterData = createCsvWriter({
      path: `data/github-repositories.csv`,
      header: [
        {id: 'nomRepo', title: 'nomRepo'},
        {id: 'url', title: 'url'},
        {id: 'updated', title: 'updated'},
        {id: 'size', title: 'size'},
        {id: 'stars', title: 'stars'},
        {id: 'watchers', title: 'watchers'},
        {id: 'forks', title: 'forks'},
        {id: 'views', title: 'views'},
        {id: 'viewsUniques', title: 'viewsUniques'},
        {id: 'clones', title: 'clones'},
        {id: 'clonesUniques', title: 'clonesUniques'}
      ]
    });

    csvWriterData.writeRecords(repositories)
      .then(() => {
        console.log('...Done');
      });


    const csvWriter = createCsvWriter({
      path: `data/github-visits.csv`,
      header: [
        {id: 'date', title: 'date'},
        {id: 'repository', title: 'repository'},
        {id: 'clones', title: 'clones'},
        {id: 'views', title: 'views'}
      ]
    });

    csvWriter.writeRecords(results)
      .then(() => {
        console.log('...Done');
      });



  }
  catch (err) {
    handleError(err);
  }
};

asyncWrapper();
