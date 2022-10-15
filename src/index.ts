import { KubeConfig } from "@kubernetes/client-node";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import http, { IncomingMessage, ServerResponse } from "http";
import { Config } from "./config";

const HEADERS_JSON = { "Content-Type": "application/json" };
const HEADERS_HTML = { "Content-Type": "text/html; charset=utf-8" };

class IngressUpdater {
  kubeconfig: KubeConfig;
  config: Config;

  constructor() {
    const kubeconf = join(homedir(), ".kube", "config");

    this.kubeconfig = new KubeConfig();
    if (existsSync(kubeconf)) this.kubeconfig.loadFromFile(kubeconf);
    else this.kubeconfig.loadFromCluster();
    this.config = new Config(this.kubeconfig);
  }

  public async start() {
    try {
      await this.config.init();
    } catch (e) {
      if (e instanceof Error) {
        console.log(e.message);
        console.log(e.stack);
      }
    }
    void this.config.watchIngresses();
    void this.config.watchPods();

    const sendList = (request: IncomingMessage, response: ServerResponse, list: string[]) => {
      const url = request.url || "/";
      const reqHeaders = request.headers || {};
      const accept = reqHeaders.accept || '';
      // accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9
      const useHTML = accept.startsWith("text/html");
      if (useHTML) {
        response.writeHead(200, HEADERS_HTML);
        const prefix = url.endsWith("/") ? '.' : url.replace(/$.*\//, "");
        response.end(`<html><body><ul>${list.map(a=>`<li><a href="${prefix}/${a}/">${a}</li>`).join('')}</ul></body></html>`, "utf-8");
      } else {
        response.writeHead(200, HEADERS_JSON);
        response.end(JSON.stringify(list), "utf-8");
      }
    }

    http
      .createServer((request, response) => {
        if (request.method != "GET") {
          response.writeHead(404, HEADERS_JSON);
          response.end("404 only support GET", "utf-8");
        } else {
          const url = request.url || "/";
          const sub = this.config.getIngressConfigByPrefixBase(url);
          if (sub) {
            sendList(request, response, sub.getNodeNames());
          } else if (request.url === "/") {
            sendList(request, response, [...this.config.prefixIndex.values()].map((sub) => sub.prefixBase));
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
      })
      .listen(this.config.HTTP_PORT, () => {
        console.log(`Listening to port: ${this.config.HTTP_PORT} for service "${this.config.selfServiceName}"`)
      });
  }
}
const updater = new IngressUpdater();
void updater.start();
