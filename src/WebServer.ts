import http, { IncomingMessage, Server, ServerResponse } from "http";
import { Config } from "./config";

const HEADERS_JSON = { "Content-Type": "application/json" };
const HEADERS_HTML = { "Content-Type": "text/html; charset=utf-8" };

export class WebServer {
  private server: ReturnType<typeof http.createServer> | null = null;
  constructor(private config: Config) { }

  /**
   * send list of sub items as json or as HTML if request is done by a webbrowser
   **/
  sendList(request: IncomingMessage, response: ServerResponse, list: string[]) {
    list = [...new Set(list)];
    const url = request.url || "/";
    const reqHeaders = request.headers || {};
    const accept = reqHeaders.accept || '';
    // accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9
    const useHTML = accept.startsWith("text/html");
    if (useHTML) {
      response.writeHead(200, HEADERS_HTML);
      let prefix = '';

      if (url.endsWith("/")) {
        if (url === "/") {
          prefix = '';
        } else {
          prefix = './';
        }
      } else {
        // keep the current folder
        prefix = url.replace(/$.*\//, "./") + '/';
      }
      // console.log({url, prefix});
      response.end(`<html><body>\r\n  <ul>\r\n${list.map(a => `    <li><a href="${prefix}${a}">${a}</li>\r\n`).join('')}  </ul>\r\n</body>\r\n</html>`, "utf-8");
    } else {
      response.writeHead(200, HEADERS_JSON);
      response.end(JSON.stringify(list), "utf-8");
    }
  }

  start(): void {
    this.server = http
      .createServer((request, response) => {
        if (request.method != "GET") {
          response.writeHead(404, HEADERS_JSON);
          response.end("404 only support GET", "utf-8");
        } else {
          const url = request.url || "/";
          const sub = this.config.getIngressConfigByPrefixBase(url);
          if (sub) {
            this.sendList(request, response, sub.getNodeNames());
          } else if (request.url === "/") {
            this.sendList(request, response, [...this.config.prefixIndex.values()].map((sub) => sub.prefixBase));
          } else {
            response.writeHead(404, HEADERS_JSON);
            const resp = {
              msg: "unknown url",
              expected: [...this.config.prefixIndex.keys()],
              url,
            };
            response.end(JSON.stringify(resp), "utf-8");
          }
        }
      });
      this.server.listen(this.config.HTTP_PORT, () => {
        console.log(`Listening to port: ${this.config.HTTP_PORT} for service "${this.config.selfServiceName}"`)
      });
  }
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}