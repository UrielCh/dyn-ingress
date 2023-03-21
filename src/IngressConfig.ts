import { V1Pod, V1Ingress, V1ObjectMeta } from "@kubernetes/client-node";
import { debounce } from "throttle-debounce";
import { IngressRouteSetConf } from "./IngressRouteSetConf";
import { Config } from "./config";
import { formatName, formatNumber, formatPrefix, formatResource, logWatchError } from "./utils";

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
      const key = `${parent}.${id}`;
      ing.validate(key);
      console.log(`"${formatName(key)}" routeSet is valid`);
    }
  }

  public visitPod(pod: V1Pod, removed?: boolean): IngressRouteSetConf[] {
    const routes: IngressRouteSetConf[] = [];
    const expects = [] as string[];
    /**
     * iterate all environement confifs
     */
    for (const child of this.configs.values()) {
      const m = child.visitPod(pod, removed);
      if (m.conf) routes.push(m.conf);
      else if (m.expect) {
        expects.push(m.expect);
      }
    }
    if (!routes.length && expects.length) {
      const metadata: V1ObjectMeta = pod.metadata!;
      console.log(`pod ${formatName(metadata.name || '?')} with prefix ${formatName(metadata.generateName || '?')} do not match any expected prefix: ${expects.map(formatName).join(', ')}, Skip, Should be Ok.`);
    }
    return routes;
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
        routes.push(`- ${pathType}:${formatPrefix(path.padEnd(15, ' '))} to service ${formatName(name)}:${formatNumber(sub.port)}`)
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
        const prefixBases = [sub.prefixBase];
        if (sub.prefixBase.length > 1) { // never add an empty route.
          prefixBases.push(sub.prefixBase.replace(/\/$/, ""));
        }
        for (const prefixBase of prefixBases) {
          paths = paths.filter((elm) => elm.path !== prefixBase);
          const path = prefixBase;
          const name = this.parent.selfServiceName;
          const pathType = "Exact";
          routes.push(`-  ${pathType}:${formatPrefix(path.padEnd(15, ' '))} to service ${formatName(name)}:${formatNumber(this.parent.HTTP_PORT)}`)
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
        console.log(`Update ingress ${formatResource(this.namespace, this.ingressName)} update failed code: ${response.statusCode}`);
      } else {
        const msg = `Update ingress ${formatResource(this.namespace, this.ingressName)} with ${formatNumber(routes.length)} routes:\n${routes.join("\n")}`;
        if (msg !== this.lastupdateIngressMessage) {
          // TODO compare with previous ingress bf update
          console.log(`Updating ingress: ${formatResource(this.namespace, this.ingressName)}:`)
          console.log(msg)
          console.log()
          this.lastupdateIngressMessage = msg
        }
      }
    } catch (e) {
      await logWatchError(`PUT ${this.parent.coreV1Api.basePath}/apis/networking.k8s.io/v1/namespaces/${this.namespace}/ingresses/${this.ingressName}`, e, 0);
    }
  }
}
