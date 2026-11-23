//go:build dev

package settings

// IgnoreSiteOrigin 让开发构建忽略数据库 / 环境变量里的 SITE_ORIGIN。
//
// 开发端口经常变化，而 SITE_ORIGIN 一旦在安装向导或后台保存就会写进 SQLite，
// 并覆盖同名环境变量；继续使用它会让请求的 Origin / Referer 与配置地址不一致，
// 表现为 /api/gallery 等接口 403 MEDIA_ORIGIN，媒体 URL 也会指向旧端口。
// 开发态回退到每个请求的 Host，浏览器用 localhost 还是 127.0.0.1 都能工作。
//
// 该方法只存在于 -tags dev 构建；生产二进制不受影响。
func (m *Manager) IgnoreSiteOrigin() {
	m.mu.Lock()
	m.ignoreSiteOrigin = true
	m.mu.Unlock()
}
