import { V1Pod, V1Ingress } from "@kubernetes/client-node";
import { debounce } from "throttle-debounce";
import { IngressRouteSetConf } from "./IngressRouteSetConf";
import { Config } from "./config";
import { logWatchError } from "./utils";

export class IngressConfig {
  public ingress: V1Ingress | null = null;
  // previously pushed
  prevNode = ""; // or []
  virtualHost = "";
  configs = new Map<number, IngressRouteSetConf>();
  change = debounce(500, () => this.updateIngress());

  constructor(public readonly parent: Config, public readonly namespace: string, public readonly ingressName: string) { }
  create(id: number): IngressRouteSetConf {
    let old = this.configs.get(id);
    if (!old) {
      old = new IngressRouteSetConf(this);
      this.configs.set(id, old);
    }
    return old;
  }

  public validate(parent: string): void {
    for (const [id, ing] of this.configs.entries()) {
      ing.validate(`${parent}.${id}`);
      console.log(`"${parent}.${id}" routeSet is valid`);
    }
  }

  public visitPod(pod: V1Pod, removed?: boolean): IngressRouteSetConf | null {
    for (const child of this.configs.values()) {
      const m = child.visitPod(pod, removed);
      if (m) return m;
    }
    return null;
  }

  lastupdateIngressMessage = "";

  async updateIngress() {
    // virtualHost
    if (!this.ingress) return;
    const ingress = this.ingress;
    const signature = [];
    for (const sub of this.configs.values()) {
      for (const n of sub.getNodeNames()) signature.push(n);
      signature.push(";");
    }
    // look for changes
    const newListTxt = signature.join(",");
    if (newListTxt === this.prevNode) return; // np changes
    // const INGRESS_HOST = config.INGRESS_HOST[confId];
    this.prevNode = newListTxt;
    const routes = [] as string[];
    // console.log(
    //   "Live pods:",
    //   [...this.nodeList.values()].map((n) => `${n.podName} on Node ${n.nodeName}`),
    // );
    // const ingress = this.ingresses[confId];
    if (!ingress.spec) ingress.spec = {};
    const spec = ingress.spec;
    if (!spec.rules) spec.rules = [];
    const rules = spec.rules;
    if (!rules.length) rules.push({ host: this.virtualHost });
    const rule = rules.find((r) => r.host == this.virtualHost) || rules[0];
    if (!rule.http) rule.http = { paths: [] };
    const http = rule.http;
    let paths = http.paths;
    for (const sub of this.configs.values()) {
      // drop old rules, and rewrite thems
      const servicePrefix = `${sub.generateName}service-`;
      paths = paths.filter((elm) => !elm.backend.service || !elm.backend.service.name.startsWith(servicePrefix));
      // let pathPrefix = sub.prefix.replace("NODENAME", );

      // if (!pathPrefix.startsWith("/")) pathPrefix = "/" + pathPrefix;
      for (const node of sub.nodeList.values()) {
        const nodeName = node.nodeName;
        const path = sub.prefix.replace("NODENAME", nodeName);
        const name = `${servicePrefix}${nodeName}`;
        const pathType = "Prefix";
        routes.push(`- ${pathType}:${path} to ${name}:${sub.port}`)
        paths.push({
          path,
          pathType,
          backend: {
            service: {
              name,
              port: {
                number: Number(sub.port),
              },
            },
          },
        });
      }
    }

    // add advertising roots
    if (this.parent.selfServiceName)
      for (const sub of this.configs.values()) {
        // drop old rules, and rewrite thems
        // const servicePrefix = `${sub.generateName}service-`;
        paths = paths.filter((elm) => elm.path !== sub.prefixBase);
        const path = sub.prefixBase;
        const name = this.parent.selfServiceName;
        const pathType = "Exact";
        routes.push(`- ${pathType}:${path} to ${name}:${this.parent.HTTP_PORT}`)
        paths.push({
          path,
          pathType,
          backend: {
            service: {
              name,
              port: {
                number: Number(this.parent.HTTP_PORT),
              },
            },
          },
        });
      }

    // overwrite paths TODO compare paths for changes
    http.paths = paths;
    delete ingress.status;
    if (ingress.metadata) {
      delete ingress.metadata.creationTimestamp;
      delete ingress.metadata.generation;
      delete ingress.metadata.managedFields;
      delete ingress.metadata.resourceVersion;
      delete ingress.metadata.uid;
    }
    try {
      const { response } = await this.parent.networkingV1Api.replaceNamespacedIngress(this.ingressName, this.namespace, ingress);
      if (response.statusCode !== 200) {
        console.log(`Update ingress ${this.namespace}.${this.ingressName} update failed code: ${response.statusCode}`);
      } else {
        const msg = `Update ingress ${this.namespace}.${this.ingressName} with ${routes.length} routes:\n${routes.join("\n")}`;
        if (msg !== this.lastupdateIngressMessage) {
          // TODO compare with previous ingress bf update
          console.log(msg)
          this.lastupdateIngressMessage = msg
        }
      }
    } catch (e) {
      await logWatchError(`PUT /apis/networking.k8s.io/v1/namespaces/${this.namespace}/ingresses/${name}`, e, 0);
    }
  }
}
