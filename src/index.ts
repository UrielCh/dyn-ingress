import { KubeConfig } from "@kubernetes/client-node";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import http from "http";
import { Config } from "./config";

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
    http
      .createServer((request, response) => {
        const headers = { "Content-Type": "application/json" };
        if (request.method != "GET") {
          response.writeHead(404, headers);
          response.end("404 only support GET", "utf-8");
        } else {
          const url = request.url || "/";
          const sub = this.config.getIngressConfigByPrefixBase(url);
          if (sub) {
            response.writeHead(200, headers);
            const resp = sub.getNodeNames();
            response.end(JSON.stringify(resp), "utf-8");
          } else if (request.url === "/") {
            response.writeHead(200, headers);
            const resp = [...this.config.prefixIndex.values()].map((sub) => sub.prefixBase);
            response.end(JSON.stringify(resp), "utf-8",
            );
          } else {
            response.writeHead(404, headers);
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
console.log("Stating V2");
const updater = new IngressUpdater();
void updater.start();
