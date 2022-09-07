# Dyn-ingress

Dyn-ingress can solve two Kubernetes common issue:

- Add a label containing the node name on each pod.
- Create and maintain an Ingress to access your pod directly.

## labeling only feature

If you only need to add node name label use this image and use the following env variables:
- `LABEL.all = 1` force the container to tag all pods
- `LABEL_NODE_NAME = nodename` change the default label name to store the node name (default is `nodename`)
- `NAMESPACE = default` choose the namespace you will work with

Minimal configuration:
```YAML
apiVersion: v1
kind: Pod
metadata:
  name: dyn-ingress
spec:
  containers:
  - name: dyn-ingress
    image: urielch/dyn-ingress:latest
    env:
    - name: LABEL.all
      value: "1"
    - name: NAMESPACE
      value: "default"
```

## Enable Ingress

This image had been created to get direct access to all your pods via an Ingress. This is meant to be used with a DemonSet / Deployment or StateFulset.

To activate this feature, you must define this environment variables:

- `INGRESS.{NAMESPACE}.{IngresName}.host` the virtualhost to use, (MUST exist in the piloted Ingress)
- `INGRESS.{NAMESPACE}.{IngresName}.1.name` name of the DemonSet / Deployment or StateFulset you want to access
- `INGRESS.{NAMESPACE}.{IngresName}.1.selector` selector to match your pods like `app=MyApp`
- `INGRESS.{NAMESPACE}.{IngresName}.1.prefix` Prefix for the new Ingress routes example: `/no-lb-service/NODENAME`, NODENAME will be replace by the actial nodename
- `INGRESS.{NAMESPACE}.{IngresName}.1.port` Service pod port
- `INGRESS.{NAMESPACE}.{IngresName}.1.targetPort` Service pod targetPort
- `HTTP_PORT` Dyn-ingress pod will listen to this port for his ingress index

To fin the current available routes, dyn-ingress will create two extra entry point route per configuration, the vrevious configuration will add `/no-lb-service/` and `/no-lb-service` that will return a json list of available nodes.

### Ingress K3d sample configuration

```YAML
apiVersion: v1
kind: Pod
metadata:
  name: dyn-ingress
spec:
  containers:
  - name: dyn-ingress
    image: urielch/dyn-ingress:latest
    env:
    - name: HTTP_PORT
      value: "8080"
    - name: INGRESS.default.my-ingress.host
      value: ""
    - name: INGRESS.default.my-ingress.1.name
      value: "my-deployment"
    - name: INGRESS.default.my-ingress.1.selector
      value: "app=my-deployment"
    - name: INGRESS.default.my-ingress.1.prefix
      value: "/stuff/NODENAME"
    - name: INGRESS.default.my-ingress.1.port
      value: "8080"
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  namespace: default
  annotations:
    kubernetes.io/ingress.class: traefik
    traefik.ingress.kubernetes.io/router.middlewares: default-strip-prefix@kubernetescrd
spec:
  rules:
    - http:
        paths:
          - path: /dummy
            pathType: Prefix
            backend:
              service:
                name: non-existing-service
                port:
                  number: 80
```
This configuration will add extra route: `http://<cluser>/stuff/nodename/url` to be redirect to `http://<podIP>:80/url`


### Full sample with RBAC

```YAML
# Middleware to drop prefix
apiVersion: traefik.containo.us/v1alpha1
kind: Middleware
metadata:
  name: strip-prefix
  annotations:
    kubernetes.io/ingress.class: traefik
spec:
  replacePathRegex:
    regex: ^/(?:[^/]+)/?(.*)
    replacement: /$1
---
# The dynamique ingress with an exact path /list to get all nodes
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: remote-droid-ingress
  namespace: default
  annotations:
    kubernetes.io/ingress.class: traefik
    traefik.ingress.kubernetes.io/router.middlewares: default-strip-prefix@kubernetescrd
spec:
  rules:
    - http:
        paths:
          - path: /list
            pathType: Exact
            backend:
              service:
                name: dyn-ingress-service
                port:
                  number: 8080
---
# Create a service account for dyn-ingress
apiVersion: v1
kind: ServiceAccount
metadata:
  name: dyn-ingress-account
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: default
  name: dyn-ingress-account
rules:
- apiGroups: [""] # "" indicates the core API group
  resources: ["pods"]
  verbs: ["get", "watch", "list", "patch"]
- apiGroups: [""] # "" indicates the core API group
  resources: ["services"]
  verbs: ["get", "watch", "list", "create", "delete", "update"]
- apiGroups: ["networking.k8s.io"] # "" indicates the core API group
  resources: ["ingresses"]
  verbs: ["get", "watch", "list", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: dyn-ingress-account
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: dyn-ingress-account
subjects:
- kind: ServiceAccount
  name: dyn-ingress-account
---
# Dyn-ingress Deployement, dynamicaly manage ingresses and services
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dyn-ingress
  labels:
    app: dyn-ingress
spec:
  replicas: 1
  selector:
    matchLabels:
      app: dyn-ingress
  template:
    metadata:
      labels:
        app: dyn-ingress
    spec:
      serviceAccountName: dyn-ingress-account
      #tolerations:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: node-role.kubernetes.io/master
                    operator: In
                    values:
                      - "true"
      containers:
        - name: dyn-ingress
          image: urielch/dyn-ingress:latest
          imagePullPolicy: Always
          resources:
            limits:
              memory: 128Mi
              cpu: "0.2"
          ports:
            - containerPort: 8080
          env:
            - name: HTTP_PORT
              value: "8080"
            - name: INGRESS.default.my-ingress.host
              value: ""
            - name: INGRESS.default.my-ingress.1.name
              value: "my-deployment"
            - name: INGRESS.default.my-ingress.1.selector
              value: "app=my-deployment"
            - name: INGRESS.default.my-ingress.1.prefix
              value: "/stuff/NODENAME"
            - name: INGRESS.default.my-ingress.1.port
              value: "8080"

---
# Service to list nodename having valud pods
apiVersion: v1
kind: Service
metadata:
  name: dyn-ingress-service
spec:
  type: ClusterIP
  selector:
    app: dyn-ingress
  ports:
    - protocol: TCP
      port: 8080
      targetPort: 8080
```

### TODO:

- Publish a helm package.
- Remove "@kubernetes/client-node" dependency
- Add metric service.

