package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// commands 采用「单文件式」存储：每个 command 是 commands/<name>.md（frontmatter 存 description，正文是 prompt 模板）。
// 与 skill 不同，命令是用户显式触发的 prompt，无 references/scripts，故不用目录式。
// enabled/sortOrder/locked/origin 等用户偏好存 commands.json。
const (
	commandsDirName  = "commands"
	commandPrefsFile = "commands.json"
	commandFileExt   = ".md"
)

// 复用 skills_store.go 同包私有符号：skillNameRe、parseFrontmatter、readCapped、nowRFC3339。

// CommandMeta 是一个 command 暴露给前端的完整视图（文件扫描 + 偏好合并后的结果）。
type CommandMeta struct {
	Name        string `json:"name"`        // = 文件名（去 .md），唯一键（源:文件）
	Description string `json:"description"` // frontmatter.description，可空（源:文件）
	Origin      string `json:"origin"`      // created | imported（源:prefs）
	Locked      bool   `json:"locked"`      // 锁定态（源:prefs）
	Enabled     bool   `json:"enabled"`     // 是否进 / 补全（源:prefs）
	SortOrder   int    `json:"sortOrder"`   // 列表排序（源:prefs）
	Path        string `json:"path"`        // .md 文件绝对路径（源:文件）
	CreatedAt   string `json:"createdAt"`   // RFC3339（源:prefs）
	Version     int    `json:"version"`     // 版本号（源:prefs）
}

// commandPref 是 commands.json 里每个 command 的用户偏好条目（按 name 关联）。
type commandPref struct {
	Name      string `json:"name"`
	Origin    string `json:"origin"`
	Locked    bool   `json:"locked"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt string `json:"createdAt"`
	Version   int    `json:"version"`
}

type commandPrefsData struct {
	Version int           `json:"version"`
	Prefs   []commandPref `json:"prefs"`
}

// CommandsStore 管理 commands 目录扫描与偏好持久化。configDir 由 app.go 传入（~/.../uniTerm）。
type CommandsStore struct {
	configDir string
}

func NewCommandsStore(configDir string) *CommandsStore {
	return &CommandsStore{configDir: configDir}
}

func (s *CommandsStore) commandsRoot() string {
	return filepath.Join(s.configDir, commandsDirName)
}
func (s *CommandsStore) prefsPath() string {
	return filepath.Join(s.commandsRoot(), commandPrefsFile)
}

// ---- 偏好读写（commands.json）----

func (s *CommandsStore) loadPrefs() (commandPrefsData, error) {
	bytes, err := os.ReadFile(s.prefsPath())
	if err != nil {
		if os.IsNotExist(err) {
			return commandPrefsData{Version: 1, Prefs: []commandPref{}}, nil
		}
		return commandPrefsData{}, err
	}
	var data commandPrefsData
	if err := json.Unmarshal(bytes, &data); err != nil {
		return commandPrefsData{}, err
	}
	if data.Version == 0 {
		data.Version = 1
	}
	return data, nil
}

func (s *CommandsStore) savePrefs(data commandPrefsData) error {
	if err := os.MkdirAll(s.commandsRoot(), 0755); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.prefsPath(), bytes, 0600)
}

// ---- 文件扫描（内容/存在性以 commands/*.md 为真相源）----

// List 返回所有 command（合并文件扫描与偏好），按 sortOrder、name 排序。
func (s *CommandsStore) List() ([]CommandMeta, error) {
	root := s.commandsRoot()
	metas := []CommandMeta{}
	entries, err := os.ReadDir(root)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(e.Name()), commandFileExt) {
			continue // 跳过 commands.json 等非 .md 文件
		}
		name := strings.TrimSuffix(e.Name(), commandFileExt)
		if !skillNameRe.MatchString(name) {
			continue
		}
		mdPath := filepath.Join(root, e.Name())
		content, err := readCapped(mdPath)
		if err != nil {
			continue
		}
		fm, _ := parseFrontmatter(content)
		metas = append(metas, CommandMeta{
			Name:        name,
			Description: fm.description,
			Path:        mdPath,
		})
	}

	prefs, err := s.loadPrefs()
	if err != nil {
		return nil, err
	}
	prefMap := map[string]commandPref{}
	for _, p := range prefs.Prefs {
		prefMap[p.Name] = p
	}

	changed := false
	for i := range metas {
		m := &metas[i]
		p, ok := prefMap[m.Name]
		if !ok {
			// 文件新增但无偏好记录 → 用默认值补齐（命令默认不锁定、启用）
			p = commandPref{
				Name:      m.Name,
				Origin:    "created",
				Locked:    false,
				Enabled:   true,
				SortOrder: len(prefMap) + i,
				CreatedAt: nowRFC3339(),
				Version:   1,
			}
			prefMap[m.Name] = p
			prefs.Prefs = append(prefs.Prefs, p)
			changed = true
		}
		m.Origin = p.Origin
		m.Locked = p.Locked
		m.Enabled = p.Enabled
		m.SortOrder = p.SortOrder
		m.CreatedAt = p.CreatedAt
		m.Version = p.Version
	}

	// 清理孤儿偏好项（文件已不存在）
	present := map[string]bool{}
	for _, m := range metas {
		present[m.Name] = true
	}
	kept := prefs.Prefs[:0]
	for _, p := range prefs.Prefs {
		if present[p.Name] {
			kept = append(kept, p)
		} else {
			changed = true
		}
	}
	prefs.Prefs = kept

	if changed {
		_ = s.savePrefs(prefs) // 尽力持久化补齐/清理，失败不阻塞列表返回
	}

	sort.SliceStable(metas, func(i, j int) bool {
		if metas[i].SortOrder != metas[j].SortOrder {
			return metas[i].SortOrder < metas[j].SortOrder
		}
		return metas[i].Name < metas[j].Name
	})
	return metas, nil
}

// ---- 用户偏好修改 ----

func (s *CommandsStore) setPref(name string, fn func(p *commandPref)) error {
	prefs, err := s.loadPrefs()
	if err != nil {
		return err
	}
	found := false
	for i := range prefs.Prefs {
		if prefs.Prefs[i].Name == name {
			fn(&prefs.Prefs[i])
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("command %q not found", name)
	}
	return s.savePrefs(prefs)
}

func (s *CommandsStore) SetEnabled(name string, enabled bool) error {
	return s.setPref(name, func(p *commandPref) { p.Enabled = enabled })
}

func (s *CommandsStore) SetLocked(name string, locked bool) error {
	return s.setPref(name, func(p *commandPref) { p.Locked = locked })
}

func (s *CommandsStore) SetSortOrder(name string, order int) error {
	return s.setPref(name, func(p *commandPref) { p.SortOrder = order })
}

// GetBody 读取指定 command 的 .md 正文（不含 frontmatter），即 prompt 模板。
func (s *CommandsStore) GetBody(name string) (string, error) {
	if !skillNameRe.MatchString(name) {
		return "", fmt.Errorf("invalid command name: %s", name)
	}
	mdPath := filepath.Join(s.commandsRoot(), name+commandFileExt)
	content, err := readCapped(mdPath)
	if err != nil {
		return "", err
	}
	_, body := parseFrontmatter(content)
	return body, nil
}

// CreateCommand 从 name/description/body 创建 command（origin=created, locked=false）。
func (s *CommandsStore) CreateCommand(name, description, body string) error {
	if !skillNameRe.MatchString(name) {
		return fmt.Errorf("invalid command name: %s", name)
	}
	if err := os.MkdirAll(s.commandsRoot(), 0755); err != nil {
		return err
	}
	mdPath := filepath.Join(s.commandsRoot(), name+commandFileExt)
	content := assembleCommandMD(name, description, body)
	if err := os.WriteFile(mdPath, []byte(content), 0644); err != nil {
		return err
	}
	prefs, err := s.loadPrefs()
	if err != nil {
		return err
	}
	found := false
	for i := range prefs.Prefs {
		if prefs.Prefs[i].Name == name {
			prefs.Prefs[i].Origin = "created"
			prefs.Prefs[i].Locked = false
			prefs.Prefs[i].Enabled = true
			prefs.Prefs[i].CreatedAt = nowRFC3339()
			prefs.Prefs[i].Version++
			found = true
			break
		}
	}
	if !found {
		prefs.Prefs = append(prefs.Prefs, commandPref{
			Name:      name,
			Origin:    "created",
			Locked:    false,
			Enabled:   true,
			SortOrder: len(prefs.Prefs),
			CreatedAt: nowRFC3339(),
			Version:   1,
		})
	}
	return s.savePrefs(prefs)
}

// SaveCommand 覆盖已有 command 的正文（仅限未锁定项）。
func (s *CommandsStore) SaveCommand(name, description, body string) error {
	metas, err := s.List()
	if err != nil {
		return err
	}
	var meta CommandMeta
	found := false
	for _, m := range metas {
		if m.Name == name {
			meta = m
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("command %q not found", name)
	}
	if meta.Locked {
		return fmt.Errorf("command %q is locked", name)
	}
	mdPath := filepath.Join(s.commandsRoot(), name+commandFileExt)
	content := assembleCommandMD(name, description, body)
	if err := os.WriteFile(mdPath, []byte(content), 0644); err != nil {
		return err
	}
	return s.setPref(name, func(p *commandPref) {
		p.Version++
		p.CreatedAt = nowRFC3339()
	})
}

// Delete 删除指定 command 的 .md 文件与偏好记录。
func (s *CommandsStore) Delete(name string) error {
	if !skillNameRe.MatchString(name) {
		return fmt.Errorf("invalid command name: %s", name)
	}
	mdPath := filepath.Join(s.commandsRoot(), name+commandFileExt)
	if err := os.Remove(mdPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	// 清理偏好（靠 List 的孤儿清理去除偏好项）
	return s.setPref(name, func(p *commandPref) {})
}

func assembleCommandMD(name, description, body string) string {
	return fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n%s", name, description, body)
}
