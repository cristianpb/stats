import axios from 'axios';
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

    let results = [];
    const repositories = [];
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
          referers: referrers.reduce((a, b) => a + b.count, 0),
          referersUniques: referrers.reduce((a, b) => a + b.uniques, 0),
          pathsVisits: pathsVisits.reduce((a, b) => a + b.count, 0),
          pathsVisitsUniques: pathsVisits.reduce((a, b) => a + b.uniques, 0)
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
          let joinArray: any = results.concat(dataWrite);
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
        {id: 'clonesUniques', title: 'clonesUniques'},
        {id: 'referrers', title: 'referers'},
        {id: 'referersUniques', title: 'referersUniques'},
        {id: 'pathsVisits', title: 'pathsVisits'},
        {id: 'pathsVisitsUniques', title: 'pathsVisitsUniques'}
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

interface Referrer {
  "referrer": string; //"Google";
  "count": number; //4;
  "uniques": number; //3;
}

interface Path {
  "path": string; //"/github/hubot",
  "title": string; //"github/hubot: A customizable life embetterment robot.",
  "count": number; //3542,
  "uniques": number; //2225
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
