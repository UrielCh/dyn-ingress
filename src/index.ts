import { KubeConfig } from "@kubernetes/client-node";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { Config } from "./config";
import { WebServer } from "./WebServer";
import { IngressConfig } from "./IngressConfig";

class IngressUpdater {
  kubeconfig: KubeConfig;
  config: Config;

  constructor() {
    const KUBCONFIG_NAME = process.env["KUBCONFIG_NAME"] || "config";
    const kubeconf = join(homedir(), ".kube", KUBCONFIG_NAME);

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
    const keys = [...this.config.ingresses.keys()];
    console.log(`Starting DynIngress with ${keys.length} Services`)
    for (const key of keys) {
      console.log(`Service: ${key}`)
      const config = this.config.ingresses.get(key) as IngressConfig;
      console.log(`  ingressName: ${config.ingressName}`);
      if (config.configs.size > 1)
        console.log(`  contains ${config.configs.size} routes`);
      for (const sub of config.configs.values()) {
        console.log(`    route ${sub.name} matching pod having label ${sub.selectorKey}=${sub.selectorValue}`);
        console.log(`    exposing route in ${sub.prefix}`);
      }
      //console.log(`ingressName: ${config.configs.size}`);

    }
    // log tasks
    // console.log(this.config.ingresses);
    // this.config.ingresses.

    void this.config.watchIngresses();
    void this.config.watchPods();
    const webserver = new WebServer(this.config);
    webserver.start();
  }
}
const updater = new IngressUpdater();
void updater.start();
