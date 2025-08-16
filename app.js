class CollaborativePlatform {
  constructor() {
    this.socket = null;
    this.editor = null;
    this.currentUser = null;
    this.currentDocument = null;
    this.otherUsers = new Map();
    this.documents = [];
    this.selectedColor = '#3b82f6';
    this.selectedLanguage = 'javascript';
    this.sidebarCollapsed = false;
    this._applyingRemoteChange = false;
    this.init();
  }
  init() {
    this.setupEventListeners();
    this.initializeMonaco();
  }
  getEl(id) {
    return document.getElementById(id) || null;
  }
  setupEventListeners() {
    const loginForm = this.getEl('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleLogin();
      });
    }
    const colorOptions = document.querySelectorAll('.color-option') || [];
    colorOptions.forEach((option) => {
      option.addEventListener('click', () => {
        colorOptions.forEach((o) => o.classList.remove('selected'));
        option.classList.add('selected');
        if (option.dataset && option.dataset.color) {
          this.selectedColor = option.dataset.color;
        }
      });
    });
    const toggleSidebar = this.getEl('toggleSidebar');
    if (toggleSidebar) {
      toggleSidebar.addEventListener('click', () => {
        this.toggleSidebar();
      });
    }
    const newDocBtn = this.getEl('newDocBtn');
    if (newDocBtn) {
      newDocBtn.addEventListener('click', () => {
        this.showCreateDocumentModal();
      });
    }
    const createDocForm = this.getEl('createDocForm');
    if (createDocForm) {
      createDocForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.createDocument();
      });
    }
    const closeCreateModal = this.getEl('closeCreateModal');
    if (closeCreateModal) {
      closeCreateModal.addEventListener('click', () => {
        this.hideCreateDocumentModal();
      });
    }
    const cancelCreate = this.getEl('cancelCreate');
    if (cancelCreate) {
      cancelCreate.addEventListener('click', () => {
        this.hideCreateDocumentModal();
      });
    }
    const languageOptions = document.querySelectorAll('.language-option') || [];
    languageOptions.forEach((option) => {
      option.addEventListener('click', () => {
        languageOptions.forEach((o) => o.classList.remove('selected'));
        option.classList.add('selected');
        if (option.dataset && option.dataset.language) {
          this.selectedLanguage = option.dataset.language;
        }
      });
    });
  }
  initializeMonaco() {
    if (typeof require !== 'undefined') {
      try {
        require.config({ paths: { vs: 'https://unpkg.com/monaco-editor@0.39.0/min/vs' } });
        require(['vs/editor/editor.main'], () => {
          console.log('Monaco Editor loaded (preload).');
        });
      } catch (err) {
        console.warn('Monaco require config failed:', err);
      }
    } else {
      console.warn('`require` is not available in this environment. Monaco may fail to load.');
    }
  }
  handleLogin() {
    const nameEl = this.getEl('userName');
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) return;
    this.currentUser = {
      id: this.generateId(),
      name: name,
      avatar: name.charAt(0).toUpperCase(),
      color: this.selectedColor
    };
    this.connectToServer();
    this.hideLoginModal();
    this.updateCurrentUserInfo();
  }
  connectToServer() {
    if (typeof io === 'undefined') {
      console.error('Socket.io (io) is not available. Make sure socket.io client is loaded.');
      return;
    }
    try {
      this.socket = io('http://localhost:3001');
      this.socket.on('connect', () => {
        console.log('Connected to server');
        this.updateConnectionStatus(true);
        if (this.currentUser) {
          this.socket.emit('user-join', this.currentUser);
        }
      });
      this.socket.on('disconnect', () => {
        console.log('Disconnected from server');
        this.updateConnectionStatus(false);
      });
      this.socket.on('user-registered', (user) => {
        if (user) {
          this.currentUser = user;
        }
        this.loadDocuments();
      });
      this.socket.on('documents-list', (docs) => {
        this.documents = Array.isArray(docs) ? docs : [];
        this.renderDocumentsList();
      });
      this.socket.on('document-created', (newDoc) => {
        if (!newDoc) return;
        this.documents.push(newDoc);
        this.renderDocumentsList();
        this.selectDocument(newDoc);
        this.hideCreateDocumentModal();
      });
      this.socket.on('document-loaded', (doc) => {
        if (!doc) return;
        this.currentDocument = doc;
        this.loadDocumentInEditor(doc);
        this.updateCurrentDocumentTitle(doc.title);
      });
      this.socket.on('text-changed', (data) => {
        if (!data) return;
        if (this.socket && data.userId && this.socket.id && data.userId === this.socket.id) {
          return;
        }
        if (this.editor && data.content != null) {
          this._applyingRemoteChange = true;
          try {
            const currentValue = this.editor.getValue();
            if (currentValue !== data.content) {
              this.editor.setValue(data.content);
            }
          } finally {
            setTimeout(() => {
              this._applyingRemoteChange = false;
            }, 0);
          }
        }
      });
      this.socket.on('cursor-updated', (data) => {
        if (!data) return;
        if (this.socket && data.userId && this.socket.id && data.userId === this.socket.id) {
          return;
        }
        if (data.userId && data.user && data.cursor) {
          this.updateUserCursor(data.userId, data.user, data.cursor);
        }
      });
      this.socket.on('users-in-document', (users) => {
        if (!Array.isArray(users)) return;
        this.updateUsersInDocument(users);
      });
      this.socket.on('user-joined-document', (user) => {
        if (!user || !user.id) return;
        if (this.socket && user.id === this.socket.id) return;
        this.otherUsers.set(user.id, user);
        this.updateUserPresence();
      });
      this.socket.on('user-left-document', (userId) => {
        if (!userId) return;
        this.otherUsers.delete(userId);
        this.updateUserPresence();
        this.removeUserCursor(userId);
      });
    } catch (err) {
      console.error('Error connecting to server:', err);
    }
  }
  loadDocuments() {
    if (!this.socket) return;
    this.socket.emit('get-documents');
  }
  renderDocumentsList() {
    const container = this.getEl('documentsList');
    if (!container) return;
    container.innerHTML = '';
    this.documents.forEach((doc) => {
      const item = document.createElement('div');
      item.className = `document-item ${this.currentDocument?.id === doc.id ? 'active' : ''}`;
      item.innerHTML = `
        <div style="display: flex; align-items: start; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
            <span style="font-size: 18px;">${this.getLanguageIcon(doc.language)}</span>
            <div style="flex: 1; min-width: 0;">
              <h4 style="font-weight: 500; margin: 0; color: white; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${this._escapeHtml(doc.title || 'Untitled')}
              </h4>
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <span style="font-size: 12px; color: #6b7280;">
                  ${this.formatDate(doc.lastModified)}
                </span>
              </div>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14,2 14,8 20,8"></polyline>
          </svg>
        </div>
      `;
      item.addEventListener('click', () => {
        this.selectDocument(doc);
      });
      container.appendChild(item);
    });
  }
  selectDocument(doc) {
    if (!doc || !this.socket) return;
    this.currentDocument = doc;
    this.socket.emit('join-document', doc.id);
    this.renderDocumentsList();
    this.showEditor();
  }
  showEditor() {
    const noDocument = this.getEl('noDocument');
    const monacoContainer = this.getEl('monacoContainer');
    if (noDocument) noDocument.style.display = 'none';
    if (monacoContainer) monacoContainer.style.display = 'block';
  }
  loadDocumentInEditor(doc) {
    if (!doc) return;
    if (!this.editor) {
      this.createEditor(doc);
    } else {
      const content = doc.content != null ? String(doc.content) : '';
      try {
        this._applyingRemoteChange = true;
        if (this.editor.getValue() !== content) {
          this.editor.setValue(content);
        }
        if (doc.language && typeof monaco !== 'undefined') {
          monaco.editor.setModelLanguage(this.editor.getModel(), doc.language);
        }
      } finally {
        setTimeout(() => {
          this._applyingRemoteChange = false;
        }, 0);
      }
    }
  }
  createEditor(doc) {
    if (typeof require === 'undefined') {
      console.error('Monaco require is not available. Editor cannot be created.');
      return;
    }
    require(['vs/editor/editor.main'], () => {
      try {
        const container = this.getEl('monacoContainer');
        if (!container) {
          console.error('monacoContainer element not found.');
          return;
        }
        this.editor = monaco.editor.create(container, {
          value: doc.content || '',
          language: doc.language || 'plaintext',
          theme: 'vs-dark',
          automaticLayout: true,
          fontSize: 14,
          lineNumbers: 'on',
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          renderWhitespace: 'selection',
          cursorBlinking: 'smooth',
          smoothScrolling: true
        });
        this.editor.onDidChangeModelContent(() => {
          if (this._applyingRemoteChange) return;
          if (this.socket && this.currentDocument && this.currentUser) {
            const content = this.editor.getValue();
            this.socket.emit('text-change', {
              documentId: this.currentDocument.id,
              content,
              version: (this.currentDocument.version || 0) + 1
            });
          }
        });
        this.editor.onDidChangeCursorPosition((e) => {
          if (this.socket && this.currentDocument && this.currentUser) {
            const cursor = {
              line: e.position.lineNumber,
              column: e.position.column
            };
            this.socket.emit('cursor-update', {
              documentId: this.currentDocument.id,
              cursor
            });
          }
        });
      } catch (err) {
        console.error('Error creating Monaco editor:', err);
      }
    });
  }
  createDocument() {
    const titleEl = this.getEl('docTitle');
    if (!titleEl || !this.socket) return;
    const title = titleEl.value.trim();
    if (!title) return;
    const docData = {
      id: this.generateId(),
      title: title,
      language: this.selectedLanguage,
      content: this.getDefaultContent(this.selectedLanguage),
      lastModified: new Date().toISOString()
    };
    this.socket.emit('create-document', docData);
  }
  getDefaultContent(language) {
    const templates = {
      javascript: '// Welcome to your new JavaScript file\n\nfunction hello() {\n  console.log("Hello, world!");\n}\n\nhello();',
      typescript: '// Welcome to your new TypeScript file\n\nfunction hello(): void {\n  console.log("Hello, world!");\n}\n\nhello();',
      python: '# Welcome to your new Python file\n\ndef hello():\n    print("Hello, world!")\n\nhello()',
      html: '<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Document</title>\n</head>\n<body>\n    <h1>Hello, world!</h1>\n</body>\n</html>',
      css: '/* Welcome to your new CSS file */\n\nbody {\n    font-family: Arial, sans-serif;\n    margin: 0;\n    padding: 20px;\n}\n\nh1 {\n    color: #333;\n    text-align: center;\n}',
      markdown: '# Welcome to your new Markdown file\n\n## Getting Started\n\nThis is a **markdown** file. You can use it to write documentation, notes, or any other text content.\n\n### Features\n\n- **Bold text**\n- *Italic text*\n- `Code snippets`\n- [Links](https://example.com)\n\n> This is a blockquote\n\n```javascript\nconsole.log("Hello, world!");\n```',
      json: '{\n  "name": "My Project",\n  "version": "1.0.0",\n  "description": "A new project",\n  "main": "index.js"\n}',
      plaintext: 'Welcome to your new document!\n\nStart typing here...'
    };
    return templates[language] || templates.plaintext;
  }
  updateUserCursor(userId, user, cursor) {
    if (!userId) return;
    this.otherUsers.set(userId, { ...user, cursor });
    this.removeUserCursor(userId);
    if (cursor && this.editor) {
      const container = this.getEl('monacoContainer');
      if (!container) return;
      const cursorElement = document.createElement('div');
      cursorElement.className = 'user-cursor';
      cursorElement.id = `cursor-${userId}`;
      cursorElement.style.position = 'absolute';
      cursorElement.style.top = `${Math.max(0, (cursor.line - 1) * 19 + 4)}px`;
      cursorElement.style.left = `${Math.max(0, cursor.column * 7 + 60)}px`;
      cursorElement.style.pointerEvents = 'none';
      cursorElement.style.zIndex = '50';
      cursorElement.innerHTML = `
        <div class="user-cursor-line" style="width:2px; height:18px; background-color: ${this._escapeHtml(user.color || '#888')}; position:absolute; left:0; top:0;"></div>
        <div class="user-cursor-label" style="position: absolute; left:8px; top:-2px; padding:2px 6px; border-radius:4px; font-size:11px; color:#fff; background-color:${this._escapeHtml(user.color || '#888')}">
          ${this._escapeHtml(user.name || 'User')}
        </div>
      `;
      container.appendChild(cursorElement);
    }
  }
  removeUserCursor(userId) {
    const cursor = this.getEl(`cursor-${userId}`);
    if (cursor && cursor.parentNode) {
      cursor.parentNode.removeChild(cursor);
    }
  }
  updateUsersInDocument(users) {
    this.otherUsers.clear();
    (users || []).forEach((user) => {
      if (!this.socket || user.id !== this.socket.id) {
        this.otherUsers.set(user.id, user);
      }
    });
    this.updateUserPresence();
  }
  updateUserPresence() {
    const userPresence = this.getEl('userPresence');
    const userCount = this.getEl('userCount');
    const userAvatars = this.getEl('userAvatars');
    if (!userPresence || !userCount || !userAvatars) return;
    const otherUsersArray = Array.from(this.otherUsers.values());
    if (otherUsersArray.length === 0) {
      userPresence.style.display = 'none';
      return;
    }
    userPresence.style.display = 'flex';
    userCount.textContent = `${otherUsersArray.length} other${otherUsersArray.length !== 1 ? 's' : ''} editing`;
    userAvatars.innerHTML = '';
    otherUsersArray.slice(0, 5).forEach((user, index) => {
      const avatar = document.createElement('div');
      avatar.className = 'user-avatar';
      avatar.style.backgroundColor = user.color || '#6b7280';
      avatar.style.marginLeft = index > 0 ? '-8px' : '0';
      avatar.textContent = (user.name || 'U').charAt(0).toUpperCase();
      avatar.title = user.name || 'User';
      userAvatars.appendChild(avatar);
    });
    if (otherUsersArray.length > 5) {
      const moreAvatar = document.createElement('div');
      moreAvatar.className = 'user-avatar';
      moreAvatar.style.backgroundColor = '#4b5563';
      moreAvatar.style.marginLeft = '8px';
      moreAvatar.textContent = `+${otherUsersArray.length - 5}`;
      userAvatars.appendChild(moreAvatar);
    }
  }
  toggleSidebar() {
    const sidebar = this.getEl('sidebar');
    if (!sidebar) return;
    this.sidebarCollapsed = !this.sidebarCollapsed;
    if (this.sidebarCollapsed) {
      sidebar.classList.add('collapsed');
    } else {
      sidebar.classList.remove('collapsed');
    }
  }
  showCreateDocumentModal() {
    const modal = this.getEl('createDocModal');
    const title = this.getEl('docTitle');
    if (!modal) return;
    modal.style.display = 'flex';
    if (title) {
      title.value = '';
      title.focus();
    }
  }
  hideCreateDocumentModal() {
    const modal = this.getEl('createDocModal');
    if (!modal) return;
    modal.style.display = 'none';
  }
  hideLoginModal() {
    const loginModal = this.getEl('loginModal');
    if (!loginModal) return;
    loginModal.style.display = 'none';
  }
  updateConnectionStatus(connected) {
    const statusDot = this.getEl('statusDot');
    const statusText = this.getEl('statusText');
    if (!statusDot || !statusText) return;
    if (connected) {
      statusDot.className = 'status-dot status-connected';
      statusText.textContent = 'Connected';
    } else {
      statusDot.className = 'status-dot status-disconnected';
      statusText.textContent = 'Disconnected';
    }
  }
  updateCurrentUserInfo() {
    const userInfo = this.getEl('currentUserInfo');
    const userAvatar = this.getEl('currentUserAvatar');
    const userName = this.getEl('currentUserName');
    if (!userInfo || !userAvatar || !userName || !this.currentUser) return;
    userInfo.style.display = 'flex';
    userAvatar.style.backgroundColor = this.currentUser.color || '#3b82f6';
    userAvatar.textContent = this.currentUser.name.charAt(0).toUpperCase();
    userName.textContent = this.currentUser.name;
  }
  updateCurrentDocumentTitle(title) {
    const el = this.getEl('currentDocTitle');
    if (!el) return;
    el.textContent = title || 'Untitled';
  }
  getLanguageIcon(language) {
    const icons = {
      javascript: '🟨',
      typescript: '🔷',
      python: '🐍',
      html: '🌐',
      css: '🎨',
      json: '📋',
      markdown: '📝',
      plaintext: '📄'
    };
    return icons[language] || '📝';
  }
  formatDate(dateString) {
    if (!dateString) return '';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  _escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
document.addEventListener('DOMContentLoaded', () => {
  new CollaborativePlatform();
});
