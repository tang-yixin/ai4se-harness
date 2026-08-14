# 基础镜像：Node.js 22 LTS（Alpine 精简版）
FROM node:22-alpine

# 构建目录：与运行时挂载点 /workspace 分离，
# 避免 `docker run -v $(pwd):/workspace` 挂载时覆盖掉构建产物 dist/。
WORKDIR /app

# 先复制依赖清单以利用 Docker 层缓存（依赖未变则跳过 npm ci）
COPY package.json package-lock.json ./
RUN npm ci

# 复制其余源码并编译到 dist/
COPY . .
RUN npm run build

# 全局安装本项目（读取 package.json 的 bin 字段，把 harness 命令挂到 PATH）
RUN npm install -g .

# 运行时工作目录：用户通过 -v 挂载项目源码到此处
WORKDIR /workspace

# 默认入口：harness CLI（npm 全局安装的 bin，符号链接指向 dist/cli/index.js）
ENTRYPOINT ["harness"]
