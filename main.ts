import { 
	App, 
	TFolder,
	Plugin, 
	PluginSettingTab, 
	Setting, 
	TAbstractFile, 
	TFile,
	WorkspaceLeaf,
	normalizePath,
	Notice,
	Menu,
	ViewState
} from 'obsidian';

// 不再使用固定文件名，而是动态获取

interface FileExplorer {
	onClick: (event: MouseEvent, file: TAbstractFile) => void;
	filter: (file: TAbstractFile) => boolean;
	requestSort?: () => void;
	requestFilter?: () => void;
	refresh?: () => void;
	view?: any;
	[key: string]: any; // 允许任何其他可能的属性
}

export default class FolderNotePlugin extends Plugin {
	folderNoteMap: Map<string, TFile> = new Map();

	async onload() {
		// 注册说明选项卡
		this.addSettingTab(new FolderNoteInfoTab(this.app, this));
		
		// 添加命令
		this.addCommand({
			id: 'create-folder-note',
			name: '为当前文件夹创建文件夹笔记',
			checkCallback: (checking: boolean) => {
				// 获取当前活动文件
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) return false;
				
				// 获取当前文件所在的文件夹
				const parentFolder = activeFile.parent;
				if (!parentFolder) return false;
				
				// 如果只是检查命令可用性
				if (checking) return true;
				
				// 创建文件夹笔记
				this.createFolderNote(parentFolder);
				return true;
			}
		});
		
		// 监听文件系统事件
		this.registerEvent(
			this.app.vault.on('create', (file: TAbstractFile) => this.handleFileCreation(file))
		);
		
		this.registerEvent(
			this.app.vault.on('delete', (file: TAbstractFile) => this.handleFileDeletion(file))
		);

		this.registerEvent(
			this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => this.handleFileRename(file, oldPath))
		);

		// 拦截文件浏览器的点击事件
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
				if (file instanceof TFolder) {
					menu.addItem((item) => {
						item
							.setTitle("创建文件夹笔记")
							.setIcon("document")
							.onClick(async () => {
								await this.createFolderNote(file);
							});
					});
				}
			})
		);

		// 处理文件浏览器中的文件夹点击事件
		this.app.workspace.onLayoutReady(() => {
			// 延迟一下，确保文件浏览器已经加载
			setTimeout(() => {
				this.patchFileExplorer();
				this.indexExistingFolderNotes();
			}, 500);
		});
	}

	// 获取文件夹笔记的文件名
	getFolderNoteName(folder: TFolder): string {
		return `${folder.name}.md`;
	}

	// 索引现有的文件夹笔记
	async indexExistingFolderNotes() {
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			// 获取文件所在的文件夹
			const parentFolder = file.parent;
			if (parentFolder) {
				// 检查文件名是否与文件夹名称匹配
				const expectedNoteName = this.getFolderNoteName(parentFolder);
				if (file.name === expectedNoteName) {
					this.folderNoteMap.set(parentFolder.path, file);
					this.markFolderWithNote(parentFolder);
				}
			}
		}
	}

	// 为有笔记的文件夹添加标识
	markFolderWithNote(folder: TFolder) {
		try {
			// 延迟执行，确保 DOM 已经渲染
			setTimeout(() => {
				// 尝试找到文件夹的 DOM 元素
				const folderEl = document.querySelector(`.nav-folder-title[data-path="${folder.path}"]`);
				if (!folderEl) return;
				
				// 添加样式类
				folderEl.addClass('has-folder-note');
			}, 100);
		} catch (error) {
			console.error('标记文件夹失败', error);
		}
	}

	// 扩展文件浏览器的行为
	patchFileExplorer() {
		try {
			// 使用 DOM 事件监听来处理文件夹点击
			this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
				// 查找是否点击了文件浏览器中的文件夹
				const targetEl = evt.target as HTMLElement;
				if (!targetEl) return;
				
				// 查找最近的文件夹标题元素
				const folderTitleEl = targetEl.closest('.nav-folder-title') as HTMLElement;
				if (!folderTitleEl) return;
				
				// 确保是文件夹标题而不是文件
				if (folderTitleEl.parentElement?.classList.contains('nav-file')) return;
				
				// 获取文件夹路径
				const folderPath = folderTitleEl.getAttribute('data-path');
				if (!folderPath) return;
				
				// 获取对应的文件夹
				const folder = this.app.vault.getAbstractFileByPath(folderPath);
				if (!(folder instanceof TFolder)) return;
				
				// 检查该文件夹是否有关联笔记
				const folderNote = this.getFolderNoteForFolder(folder);
				if (folderNote) {
					// 阻止默认行为（展开文件夹）
					evt.preventDefault();
					evt.stopPropagation();
					
					// 打开文件夹笔记
					this.openFolderNote(folderNote);
					return;
				}
				// 如果没有关联笔记，让默认行为继续（展开文件夹）
			});
			
			// 使用 CSS 来隐藏文件夹笔记
			this.hideFolderNotesWithCSS();
		} catch (error) {
			console.error('扩展文件浏览器失败', error);
		}
	}

	// 使用 CSS 来隐藏文件夹笔记
	hideFolderNotesWithCSS() {
		try {
			// 创建一个样式元素
			const styleEl = document.createElement('style');
			styleEl.id = 'folder-note-style';
			
			// 使用 CSS 选择器匹配所有可能的文件夹笔记
			// 这里需要一个复杂的选择器，因为我们无法预先知道所有文件夹名称
			// 我们可以让插件监听文件系统变化来动态更新这个样式
			
			// 初始化样式
			this.updateHiddenNotesStyle(styleEl);
			
			document.head.appendChild(styleEl);
			
			// 保存引用以便在插件卸载时移除
			this.registerDomEvent(window, 'unload', () => {
				styleEl.remove();
			});
		} catch (error) {
			console.error('创建隐藏样式失败', error);
		}
	}
	
	// 更新隐藏笔记的样式
	updateHiddenNotesStyle(styleEl: HTMLStyleElement) {
		// 获取所有文件夹
		const folders = this.app.vault.getAllLoadedFiles()
			.filter(file => file instanceof TFolder) as TFolder[];
		
		// 构建 CSS 选择器
		let cssRules = [];
		for (const folder of folders) {
			const noteName = this.getFolderNoteName(folder);
			const notePath = `${folder.path}/${noteName}`;
			cssRules.push(`.nav-file-title[data-path="${notePath}"]`);
		}
		
		// 如果有匹配的规则，添加到样式表
		if (cssRules.length > 0) {
			styleEl.textContent = `
				${cssRules.join(',\n')} {
					display: none !important;
				}
			`;
		}
	}

	// 获取文件夹的笔记
	getFolderNoteForFolder(folder: TFolder): TFile | null {
		const folderNote = this.folderNoteMap.get(folder.path);
		if (folderNote) return folderNote;

		// 获取期望的笔记文件名
		const noteName = this.getFolderNoteName(folder);
		
		// 检查是否存在同名笔记
		const noteFilePath = normalizePath(`${folder.path}/${noteName}`);
		const file = this.app.vault.getAbstractFileByPath(noteFilePath);
		
		if (file instanceof TFile) {
			this.folderNoteMap.set(folder.path, file);
			return file;
		}
		
		return null;
	}

	// 打开文件夹笔记
	async openFolderNote(file: TFile) {
		const leaf = this.app.workspace.getUnpinnedLeaf();
		if (!leaf) return;
		
		await leaf.openFile(file);
	}

	// 创建文件夹笔记
	async createFolderNote(folder: TFolder) {
		// 检查是否已存在
		const existingNote = this.getFolderNoteForFolder(folder);
		if (existingNote) {
			new Notice('文件夹笔记已存在');
			this.openFolderNote(existingNote);
			return;
		}

		// 创建基本内容
		const content = `# ${folder.name}\n\n这是 ${folder.name} 文件夹的笔记。`;

		// 获取笔记文件名
		const noteName = this.getFolderNoteName(folder);
		
		// 创建笔记文件
		const filePath = normalizePath(`${folder.path}/${noteName}`);
		
		try {
			const file = await this.app.vault.create(filePath, content);
			this.folderNoteMap.set(folder.path, file);
			this.markFolderWithNote(folder);
			
			// 更新隐藏样式
			const styleEl = document.getElementById('folder-note-style') as HTMLStyleElement;
			if (styleEl) {
				this.updateHiddenNotesStyle(styleEl);
			}
			
			this.openFolderNote(file);
		} catch (error) {
			console.error('创建文件夹笔记失败', error);
			new Notice('创建文件夹笔记失败');
		}
	}

	// 处理文件创建事件
	handleFileCreation(file: TAbstractFile) {
		if (file instanceof TFile) {
			const parentFolder = file.parent;
			if (parentFolder) {
				// 检查文件名是否与文件夹名称匹配
				const expectedNoteName = this.getFolderNoteName(parentFolder);
				if (file.name === expectedNoteName) {
					this.folderNoteMap.set(parentFolder.path, file);
					this.markFolderWithNote(parentFolder);
					
					// 更新隐藏样式
					const styleEl = document.getElementById('folder-note-style') as HTMLStyleElement;
					if (styleEl) {
						this.updateHiddenNotesStyle(styleEl);
					}
				}
			}
		}
	}

	// 处理文件删除事件
	handleFileDeletion(file: TAbstractFile) {
		if (file instanceof TFile) {
			const parentFolder = file.parent;
			if (parentFolder) {
				// 检查文件名是否与文件夹名称匹配
				const expectedNoteName = this.getFolderNoteName(parentFolder);
				if (file.name === expectedNoteName) {
					this.folderNoteMap.delete(parentFolder.path);
					
					// 更新隐藏样式
					const styleEl = document.getElementById('folder-note-style') as HTMLStyleElement;
					if (styleEl) {
						this.updateHiddenNotesStyle(styleEl);
					}
				}
			}
		}
	}

	// 处理文件重命名事件
	handleFileRename(file: TAbstractFile, oldPath: string) {
		if (file instanceof TFolder) {
			// 文件夹被重命名，更新映射
			const oldFolderPath = oldPath;
			const folderNote = this.folderNoteMap.get(oldFolderPath);
			
			if (folderNote) {
				this.folderNoteMap.delete(oldFolderPath);
				this.folderNoteMap.set(file.path, folderNote);
				
				// 更新隐藏样式
				const styleEl = document.getElementById('folder-note-style') as HTMLStyleElement;
				if (styleEl) {
					this.updateHiddenNotesStyle(styleEl);
				}
			}
		}
		else if (file instanceof TFile) {
			// 文件被重命名
			const parentFolder = file.parent;
			if (parentFolder) {
				// 检查文件名是否与文件夹名称匹配
				const expectedNoteName = this.getFolderNoteName(parentFolder);
				if (file.name === expectedNoteName) {
					this.folderNoteMap.set(parentFolder.path, file);
					this.markFolderWithNote(parentFolder);
				}
				
				// 更新隐藏样式
				const styleEl = document.getElementById('folder-note-style') as HTMLStyleElement;
				if (styleEl) {
					this.updateHiddenNotesStyle(styleEl);
				}
			}
		}
	}

	onunload() {
		// 清理资源
		this.folderNoteMap.clear();
		
		// 移除添加的样式元素
		const styleEl = document.getElementById('folder-note-style');
		if (styleEl) {
			styleEl.remove();
		}
	}
}

// 创建一个纯粹用于显示信息的设置页面
class FolderNoteInfoTab extends PluginSettingTab {
	plugin: FolderNotePlugin;

	constructor(app: App, plugin: FolderNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		const infoDiv = containerEl.createDiv();
		infoDiv.addClass('folder-note-info');
		
		const title = infoDiv.createEl('h2');
		title.setText('Folder Note');

		const note = infoDiv.createEl('p');
		note.setText('注意：此插件不需要任何设置，开箱即用。');
		note.addClass('folder-note-important');
		
		const description = infoDiv.createEl('p');
		description.setText('该插件允许你点击文件夹时显示与文件夹同名的笔记。');
		
		const featuresList = infoDiv.createEl('ul');
		
		const features = [
			'点击文件夹时会显示该文件夹下与文件夹同名的 .md 笔记（如果存在）',
			'如果文件夹下没有同名笔记，点击时会正常展开文件夹',
			'文件夹笔记在文件浏览器中会被自动隐藏',
			'右键点击文件夹可以手动创建文件夹笔记'
		];
		
		features.forEach(feature => {
			const listItem = featuresList.createEl('li');
			listItem.setText(feature);
		});
		
		
	}
}
