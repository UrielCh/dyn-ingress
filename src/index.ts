import { KubeConfig } from "@kubernetes/client-node";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { Config } from "./config";
import { WebServer } from "./WebServer";

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
    const webserver = new WebServer(this.config);
    webserver.start();
  }
}
const updater = new IngressUpdater();
void updater.start();
