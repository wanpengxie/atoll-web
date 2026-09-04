// mock 的地址恒不写死端口。
//
// 写死 127.0.0.1:8832 的代价不是"换端口麻烦"：8832 在这台开发机上是**生产节点**的
// 端口。写死之后，任何一次 test:browser 都会把 /mock/control/reset 打到真节点上——
// 今天它只是 404，但那是运气，不是设计。测试恒不该有能力碰生产。
//
// 默认空串，于是所有请求都是相对路径，经 baseURL 落到 vite dev server，再由
// vite.config.js 的 '/mock' 代理转给这次跑的 mock。端口由 playwright.config.js
// 一处决定，测试文件恒不需要知道它是几号——F7 那两个文件本来就是这么写的。
// ATOLL_MOCK_ORIGIN 留给"要打到另一台 mock"的场合。
export const MOCK_ORIGIN = process.env.ATOLL_MOCK_ORIGIN || '';
