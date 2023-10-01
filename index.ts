import fs from 'fs';
import axios from 'axios';
import { parseString } from '@fast-csv/parse';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';

const config = {
  token: process.env['TRAFFIC_API_GITHUB_TOKEN'],
  username: 'cristianpb',
  showRateLimit: true,
  pageSize: 100
}

axios.defaults.baseURL = "https://api.github.com";
axios.defaults.headers.common["Accept"] = "application/vnd.github.v3+json";

if (config.token) {
  axios.defaults.headers.common["Authorization"] = `token ${config.token}`;
}

const parseLinkHeader = (response: any) => {
  const linkHeader = response.headers["link"];
  if (!linkHeader) {
    return [];
  }
  return linkHeader
    .split(",")
    .map((link: string) => link.split(";").map(s => s.trim()))
    .map(([hrefPart, relPart]: string[]) => {
      const href = /^<([^>]+)>$/.exec(hrefPart)[1];
      const rel = /^rel="([^"]+)"$/.exec(relPart)[1];
      return { href, rel };
    });
};

const getPages = async (url: string, config: any): Promise<any> => {
  const response = await axios.get(url, config);
  const rels = parseLinkHeader(response);
  const next = rels.find((rel: any) => rel.rel === "next");
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

const handleError = (err: any) => {
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

const flatten = (arrs: any) =>
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

    let results: Visit[] = [];
    const repositories = [];
    let detailedVisits: any = [];
    let detailedReferrers: any = [];
    let indent = 0;
    for (let index = 0; index < repos.length; index++) {
      try {
        const repo = repos[index];
        const viewsPromise: Promise<ViewsAxios> = axios.get(`/repos/${repo.owner.login}/${repo.name}/traffic/views`);
        const clonesPromise: Promise<ClonesAxios> = axios.get(`/repos/${repo.owner.login}/${repo.name}/traffic/clones`);
        const referrersPromise: Promise<ReferrerAxios> = axios.get(`/repos/${repo.owner.login}/${repo.name}/traffic/popular/referrers`);
        const pathsVisitsPromise: Promise<PathsVisitsAxios> = axios.get(`/repos/${repo.owner.login}/${repo.name}/traffic/popular/paths`);
        const [{ data: views }, { data: clones }, { data: referrers }, { data: pathsVisits }] = await Promise.all([viewsPromise, clonesPromise, referrersPromise, pathsVisitsPromise]);

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
          // referers: JSON.stringify(referrers),
          // referersCount: referrers.reduce((a, b) => a + b.count, 0),
          // referersUniques: referrers.reduce((a, b) => a + b.uniques, 0),
          // pathsVisits: JSON.stringify(pathsVisits),
          // pathsVisitsCount: pathsVisits.reduce((a, b) => a + b.count, 0),
          // pathsVisitsUniques: pathsVisits.reduce((a, b) => a + b.uniques, 0)
        }

        
        const visits: any = {}
        clones.clones.forEach((item: any) => {
          if (!(visits[item.timestamp.substring(0,10)])) visits[item.timestamp.substring(0,10)] = {}
          visits[item.timestamp.substring(0,10)].clones = item.count
        })
        views.views.forEach((item: any) => {
            if (!(visits[item.timestamp.substring(0,10)])) visits[item.timestamp.substring(0,10)] = {}
            visits[item.timestamp.substring(0,10)].views = item.count
        })

        Object.keys(visits).forEach(key => {
          results.push({
            date: key,
            repository: repo.name,
            views: visits[key].views ?  visits[key].views : 0,
            clones: visits[key].clones ?  visits[key].clones : 0
          })
        })

        if (views.count > 0 || clones.count > 0) {
          repositories.push(dataRepo);
        }

        if (pathsVisits && pathsVisits.length > 0) {
          pathsVisits.forEach(visit => {
            visit.repository = repo.name
          })
          detailedVisits = [...detailedVisits, ...pathsVisits]
        }

        if (referrers && referrers.length > 0) {
          referrers.forEach(referrer => {
            referrer.repository = repo.name
          })
          detailedReferrers = [...detailedReferrers, ...referrers]
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
        {id: 'clonesUniques', title: 'clonesUniques'},
      ]
    });

    csvWriterData.writeRecords(repositories)
      .then(() => {
        console.log('...Done writing repositories');
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
        console.log('...Done writing visits');
      });

    const csvWriterVisits = createCsvWriter({
      path: `data/github-detailled-visits.csv`,
      header: [
        {id: 'path', title: 'path'},
        {id: 'title', title: 'title'},
        {id: 'count', title: 'count'},
        {id: 'uniques', title: 'uniques'},
        {id: 'repository', title: 'repository'}
      ]
    });

    csvWriterVisits.writeRecords(detailedVisits)
      .then(() => {
        console.log('...Done writing detailled visits');
      });


    const csvWriterReferrers = createCsvWriter({
      path: `data/github-referrers.csv`,
      header: [
        {id: 'referrer', title: 'referrer'},
        {id: 'count', title: 'count'},
        {id: 'uniques', title: 'uniques'},
        {id: 'repository', title: 'repository'}
      ]
    });

    csvWriterReferrers.writeRecords(detailedReferrers)
      .then(() => {
        console.log('...Done writing referrers');
      });


  }
  catch (err) {
    handleError(err);
  }
};

const mergeAnalytics = async () => {
  const analytics: any = await axios.get('https://raw.githubusercontent.com/cristianpb/analytics-google/data/data.csv');
  const jekyll_pages: any = await axios.get('https://cristianpb.github.io/api/github-pages.json');
  const readable = parseString(analytics.data, { headers: true })  
  const agg: any = jekyll_pages.data.map((x: any) => {
    return {...x, users: 0, sessions: 0}
  })
  for await (const chunk of readable) {
    const pagePath = chunk.pagePath.replace(/\?(.+)/g, '')
    const itemIdx = agg.findIndex((x: any) => x.url === pagePath)
    if (itemIdx > -1) {
      const item = agg[itemIdx]
      item.users += +chunk.totalUsers
      item.sessions += +chunk.sessions
      agg.splice(itemIdx, 1, item);
    }
  }
  fs.writeFileSync("data/analytics-pages.json", JSON.stringify(agg));
};

asyncWrapper();
mergeAnalytics()

interface Referrer {
  referrer: string; //"Google";
  count: number; //4;
  uniques: number; //3;
  repository?: string;
}

interface Path {
  path: string; //"/github/hubot",
  title: string; //"github/hubot: A customizable life embetterment robot.",
  count: number; //3542,
  uniques: number; //2225
  repository?: string; 
}

interface View {
  "timestamp": string; //"2016-10-10T00:00:00Z",
  "count": number; //440,
  "uniques": number; //143
}

interface Views {
  "count": number; // 14850,
  "uniques": number; // 3782,
  "views": View[];
}

interface Clones {
  "count": number; // 173,
  "uniques": number; //128,
  "clones": View[]
}

interface ViewsAxios {
  data: Views;
}

interface ClonesAxios {
  data: Clones;
}

interface ReferrerAxios {
  data: Referrer[]
}

interface PathsVisitsAxios {
  data: Path[]
}

interface Visit {
  date: string;
  repository: string;
  views: number;
  clones: number;
}
