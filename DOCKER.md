# 声迹工坊 (ShengJi Workshop) - Docker 部署指南

本项目完全支持 Docker 容器化部署。由于本应用采用 **浏览器端侧本地推理架构（Web Audio + Web Worker + ONNX Runtime Web）**，容器主要负责托管前端静态页面与静态后端服务，所有计算和模型推理均在访问者的浏览器端本地执行，对服务器的 CPU/GPU 配置要求极低。

---

## 一、 快速启动（使用 Docker Compose）

确保您的机器已安装 Docker 及 Docker Compose，在项目根目录下执行：

```bash
# 构建镜像并在后台启动容器（映射至本地 3000 端口）
docker compose up -d --build
```

启动成功后，在浏览器访问：
**`http://localhost:3000`**

---

## 二、 使用 Docker 命令部署

如果您习惯直接使用 `docker` 命令：

```bash
# 1. 构建 Docker 镜像
docker build -t shengji-workshop .

# 2. 运行容器
docker run -d -p 3000:3000 --name shengji-app shengji-workshop
```

---

## 三、 局域网 / 私有服务器共享使用

如果您将本项目部署在局域网服务器、NAS 或私有云主机上：
1. 团队成员只需在局域网内通过 `http://服务器IP:3000` 访问。
2. 首次访问时，网页会自动从配置的源或缓存加载 Whisper 模型（或者您可以通过「本地模型包」导入），即可实现全团队的**纯本地、离线、零泄密音视频转文字与 SRT 导出**。
