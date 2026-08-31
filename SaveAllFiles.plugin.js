/**
 * @name SaveAllFiles
 * @author funnything1
 * @version 1.2.0
 * @description Allows you to download all files, stickers, and custom emoji from a message to a folder at once without prompts
 */

module.exports = (_ => {
	// Check if the BDFDB library is available, otherwise show download prompt
	return !window.BDFDB_Global || (!window.BDFDB_Global.loaded && !window.BDFDB_Global.started) ? class {
		constructor (meta) {for (let key in meta) this[key] = meta[key];}
		getName () {return this.name;}
		getAuthor () {return this.author;}
		getVersion () {return this.version;}
		getDescription () {return `The Library Plugin needed for ${this.name} is missing. Open the Plugin Settings to download it. \n\n${this.description}`;}
		
		downloadLibrary () {
			BdApi.Net.fetch("https://mwittrien.github.io/BetterDiscordAddons/Library/0BDFDB.plugin.js").then(r => {
				if (!r || r.status != 200) throw new Error();
				else return r.text();
			}).then(b => {
				if (!b) throw new Error();
				else return require("fs").writeFile(require("path").join(BdApi.Plugins.folder, "0BDFDB.plugin.js"), b, _ => BdApi.UI.showToast("Finished downloading BDFDB Library", {type: "success"}));
			}).catch(error => {
				BdApi.UI.alert("Error", "Could not download BDFDB Library Plugin. Try again later or download it manually from GitHub: https://mwittrien.github.io/downloader/?library");
			});
		}
		
		load () {
			if (!window.BDFDB_Global || !Array.isArray(window.BDFDB_Global.pluginQueue)) window.BDFDB_Global = Object.assign({}, window.BDFDB_Global, {pluginQueue: []});
			if (!window.BDFDB_Global.downloadModal) {
				window.BDFDB_Global.downloadModal = true;
				BdApi.UI.showConfirmationModal("Library Missing", `The Library Plugin needed for ${this.name} is missing. Please click "Download Now" to install it.`, {
					confirmText: "Download Now",
					cancelText: "Cancel",
					onCancel: _ => {delete window.BDFDB_Global.downloadModal;},
					onConfirm: _ => {
						delete window.BDFDB_Global.downloadModal;
						this.downloadLibrary();
					}
				});
			}
			if (!window.BDFDB_Global.pluginQueue.includes(this.name)) window.BDFDB_Global.pluginQueue.push(this.name);
		}
		start () {this.load();}
		stop () {}
		getSettingsPanel () {
			let template = document.createElement("template");
			template.innerHTML = `<div style="color: var(--text-strong); font-size: 16px; font-weight: 300; white-space: pre; line-height: 22px;">The Library Plugin needed for ${this.name} is missing.\nPlease click <a style="font-weight: 500;">Download Now</a> to install it.</div>`;
			template.content.firstElementChild.querySelector("a").addEventListener("click", this.downloadLibrary);
			return template.content.firstElementChild;
		}
	} : (([Plugin, BDFDB]) => {
		const saveIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" fill="currentColor"/></svg>`;
		const fs = require("fs");
		const path = require("path");
		const { shell } = require("electron");

		return class SaveAllFiles extends Plugin {
			static MAX_CONCURRENT_DOWNLOADS = 6;

			onLoad () {
				this.defaults = {
					general: {
						savePath: {value: ""},
						menuPosition: {value: "after-copy"},
						buttonLabel: {value: "Save All Files"},
						showFolderLink: {value: false},
						overwriteExisting: {value: true}
					}
				};
				// Track active observers and timeouts for cleanup
				this.activeObservers = [];
				this.activeTimeouts = [];

				// Shared across saveAllFiles() calls (not just within one) so two overlapping
				// saves — e.g. triggered from two different messages before the first finishes —
				// can't both write to the same destination path or claim the same "unique" name.
				this.pathQueues = new Map();
				this.reservedNames = new Map(); // lowercased savePath -> Set of reserved lowercase filenames

				// Caches the result of the last "does this save folder exist" check so the
				// settings panel doesn't need to hit the filesystem on every re-render.
				this.folderExistsCache = {path: null, exists: false};

				// A single shared MutationObserver serving every in-flight "add folder link
				// to toast" request, instead of one per saveAllFiles() call.
				this.pendingFolderLinks = [];
				this.sharedObserver = null;
			}
			
			onStart () {
				this.loadSettings();
				// Default to user's Downloads folder if no path is set
				if (!this.getSavePath()) {
					const userProfile = process.env.USERPROFILE || process.env.HOME;
					this.settings.general.savePath = userProfile ? path.join(userProfile, "Downloads") : "Downloads";
					this.saveSettings();
				}
			}

			onStop () {
				// Clean up all active MutationObservers
				this.activeObservers.forEach(observer => observer.disconnect());
				this.activeObservers = [];
				this.sharedObserver = null;
				this.pendingFolderLinks = [];

				// Clear all active timeouts
				this.activeTimeouts.forEach(timeout => clearTimeout(timeout));
				this.activeTimeouts = [];
				
				// Remove any injected folder links from the DOM
				document.querySelectorAll("a[data-saveallfiles-link]").forEach(link => {
					const textNode = link.previousSibling;
					if (textNode && textNode.textContent === " to ") {
						textNode.remove();
					}
					link.remove();
				});
			}

			getSavePath() {
				const p = this.settings.general.savePath;
				return typeof p === "string" ? p : (p?.value || "");
			}

			getSetting(key, defaultValue) {
				const saved = BDFDB.DataUtils.load(this, key);
				if (typeof saved === "boolean") return saved;
				if (typeof saved === "string") return saved;
				return this.settings.general[key]?.value !== undefined ? this.settings.general[key].value : defaultValue;
			}

			loadSettings() {
				this.settings.general.savePath = this.getSetting("savePath", "");
				this.settings.general.menuPosition = this.getSetting("menuPosition", "after-copy");
				this.settings.general.buttonLabel = this.getSetting("buttonLabel", "Save All Files");
				this.settings.general.showFolderLink = this.getSetting("showFolderLink", false);
				this.settings.general.overwriteExisting = this.getSetting("overwriteExisting", true);
			}

			saveSettings() {
				BDFDB.DataUtils.save(this.getSavePath(), this, "savePath");
				BDFDB.DataUtils.save(this.settings.general.menuPosition, this, "menuPosition");
				BDFDB.DataUtils.save(this.settings.general.buttonLabel, this, "buttonLabel");
				BDFDB.DataUtils.save(this.settings.general.showFolderLink, this, "showFolderLink");
				BDFDB.DataUtils.save(this.settings.general.overwriteExisting, this, "overwriteExisting");
			}

			// Persists just the one setting that changed, instead of re-writing all five
			// keys (saveSettings()) on every keystroke/toggle in the settings panel.
			saveSetting(key) {
				BDFDB.DataUtils.save(key === "savePath" ? this.getSavePath() : this.settings.general[key], this, key);
			}

			getMenuPosition(returnValue) {
				// Figure out where to insert the menu item based on user preference.
				// The returned index is the exact splice() position - callers must not add their own offset.
				const pos = this.settings.general.menuPosition || "after-copy";
				const configs = {
					"after-copy": {id: ["copy-text", "pin", "unpin"], offset: 1},
					"after-edit": {id: ["edit", "add-reaction", "add-reaction-1", "quote"], offset: 1},
					"before-copy": {id: ["copy-text", "pin", "unpin"], offset: 0},
					"top": {id: [], offset: 0},
					"bottom": {id: [], offset: 0}
				};

				const config = configs[pos] || configs["after-copy"];
				if (config.id.length === 0) {
					// Top or bottom positioning - just find the menu container
					const [container] = BDFDB.ContextMenuUtils.findItem(returnValue, {id: []}) || [returnValue];
					const list = container || returnValue;
					return [list, pos === "top" ? 0 : list.length];
				}

				// Try to find the target menu item to position relative to
				const result = BDFDB.ContextMenuUtils.findItem(returnValue, {id: config.id});
				if (result?.[0] && result[1] >= 0) return [result[0], result[1] + config.offset];

				// Fallback to common menu items if the preferred one isn't found
				const fallback = BDFDB.ContextMenuUtils.findItem(returnValue, {id: ["copy-text", "pin", "unpin"]}) ||
				                 BDFDB.ContextMenuUtils.findItem(returnValue, {id: ["edit", "add-reaction", "add-reaction-1", "quote"]});
				if (fallback?.[0] && fallback[1] >= 0) return [fallback[0], fallback[1] + 1];

				return [returnValue, returnValue.length];
			}

			// Checks (async, off the render path) whether the save folder exists, and caches
			// the result keyed on the path so re-renders triggered by unrelated fields (e.g.
			// typing in Button Label) don't re-touch the filesystem at all. Only refreshes
			// when the path itself actually changed since the last check.
			refreshFolderExistsCache(targetPath) {
				if (!targetPath || this.folderExistsCache.path === targetPath) return;
				fs.access(targetPath, fs.constants.F_OK, error => {
					// The save path may have changed again while this check was in flight.
					if (this.getSavePath() !== targetPath) return;
					this.folderExistsCache = {path: targetPath, exists: !error};
					BDFDB.ReactUtils.forceUpdate(this);
				});
			}

			getSettingsPanel () {
				const currentPath = this.getSavePath();
				this.refreshFolderExistsCache(currentPath);
				const folderExists = this.folderExistsCache.path === currentPath && this.folderExistsCache.exists;
				const menuPos = this.settings.general.menuPosition || "after-copy";
				const buttonLabel = this.settings.general.buttonLabel || "Save All Files";
				const showFolderLink = this.settings.general.showFolderLink;
				const overwriteExisting = this.settings.general.overwriteExisting;

				return BDFDB.PluginUtils.createSettingsPanel(this, {
					children: _ => [
						BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.FormItem, {
							title: "Save Folder Path:",
							className: BDFDB.disCN.marginbottom8,
							children: BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.TextInput, {
								value: currentPath,
								placeholder: "C:\\Users\\YourName\\Downloads",
								onChange: value => {
									this.settings.general.savePath = value;
									this.saveSetting("savePath");
									BDFDB.ReactUtils.forceUpdate(this);
								}
							})
						}),
						currentPath && folderExists && BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.Clickable, {
							className: BDFDB.disCN.marginbottom8,
							onClick: _ => shell.openPath(currentPath),
							children: BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.Flex, {
								align: BDFDB.LibraryComponents.Flex.Align.CENTER,
								children: [
									BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.Text, {children: "Open Folder"}),
									BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.SvgIcon, {
										name: BDFDB.LibraryComponents.SvgIcon.Names.OPEN_EXTERNAL,
										width: 16,
										height: 16
									})
								]
							})
						}),
						BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.FormItem, {
							title: "Context Menu Position:",
							className: BDFDB.disCN.marginbottom8,
							children: BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.Select, {
								value: menuPos,
								options: [
									{value: "top", label: "Top"},
									{value: "after-copy", label: "Below Copy Text"},
									{value: "after-edit", label: "Below Edit"},
									{value: "before-copy", label: "Above Copy Text"},
									{value: "bottom", label: "Bottom"}
								],
								onChange: value => {
									this.settings.general.menuPosition = value;
									this.saveSetting("menuPosition");
									BDFDB.ReactUtils.forceUpdate(this);
								}
							})
						}),
						BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.FormItem, {
							title: "Button Label:",
							className: BDFDB.disCN.marginbottom8,
							children: BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.TextInput, {
								value: buttonLabel,
								placeholder: "Save All Files",
								onChange: value => {
									this.settings.general.buttonLabel = value || "Save All Files";
									this.saveSetting("buttonLabel");
									BDFDB.ReactUtils.forceUpdate(this);
								}
							})
						}),
						BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.FormItem, {
							title: "Show Folder Link in Notification:",
							className: BDFDB.disCN.marginbottom8,
							children: BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.Switch, {
								value: showFolderLink,
								onChange: value => {
									this.settings.general.showFolderLink = value;
									this.saveSetting("showFolderLink");
									BDFDB.ReactUtils.forceUpdate(this);
								}
							})
						}),
						BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.FormItem, {
							title: "Overwrite Files With the Same Name:",
							className: BDFDB.disCN.marginbottom8,
							children: BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.Switch, {
								value: overwriteExisting,
								onChange: value => {
									this.settings.general.overwriteExisting = value;
									this.saveSetting("overwriteExisting");
									BDFDB.ReactUtils.forceUpdate(this);
								}
							})
						})
					].filter(n => n)
				});
			}

			onMessageContextMenu (e) {
				const message = e.instance?.props?.message;
				if (!message) return;

				// Computed once here and handed to the action closure below so clicking
				// the button doesn't re-parse the same message a second time.
				const fileUrls = this.getAllFileUrls(message);
				if (fileUrls.length === 0) return;

				const [children, index] = this.getMenuPosition(e.returnvalue);

				if (children) {
					children.splice(Math.max(index, 0), 0, BDFDB.ContextMenuUtils.createItem(BDFDB.LibraryComponents.MenuItems.MenuItem, {
						label: this.settings.general.buttonLabel || "Save All Files",
						id: BDFDB.ContextMenuUtils.createItemId(this.name, "save-all-files"),
						icon: _ => BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.MenuItems.MenuIcon, {icon: saveIcon}),
						action: _ => this.saveAllFiles(fileUrls).catch(error => {
							// saveAllFiles' own internal try/catches cover every expected failure
							// with a toast already; this only catches something unexpected (e.g. a
							// settings-storage read throwing) so the user isn't left with silent
							// nothing happening and no feedback at all.
							console.error("[SaveAllFiles] Unexpected error:", error);
							BdApi.UI.showToast("Save All Files failed: " + (error?.message || error), {type: "error", timeout: 3000});
						})
					}));
				}
			}
			
			getAllFileUrls(message) {
				// Collect all downloadable files from attachments and embeds
				const urls = [];
				const seenUrls = new Set();
				const timestamp = Date.now();

				// Get direct file attachments
				message.attachments?.forEach((att, i) => {
					const url = att.url || att.proxy_url || att.proxyUrl;
					if (url && !seenUrls.has(url)) {
						seenUrls.add(url);
						urls.push({url, filename: att.filename || att.name || `file_${i}_${timestamp}`});
					}
				});

				// Extract images/videos from embeds (they don't have filenames by default).
				// Skip any embed media that points at a URL we already queued (image/thumbnail
				// frequently duplicate the same resource) to avoid downloading it twice.
				const getEmbedUrl = obj => obj?.proxy_url || obj?.proxyUrl || obj?.url;
				const getExt = url => url?.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1]?.toLowerCase();

				message.embeds?.forEach((embed, i) => {
					const addEmbedFile = (obj, type, defaultExt) => {
						const url = getEmbedUrl(obj);
						if (url && !seenUrls.has(url)) {
							seenUrls.add(url);
							urls.push({url, filename: `embed_${type}_${i}_${timestamp}.${getExt(url) || defaultExt}`});
						}
					};

					if (embed.image?.url) addEmbedFile(embed.image, "image", "png");
					if (embed.thumbnail?.url) addEmbedFile(embed.thumbnail, "thumbnail", "png");
					if (embed.video?.url) addEmbedFile(embed.video, "video", "mp4");
				});

				// Stickers sent with the message. format_type: 1/2 = PNG/APNG, 3 = Lottie
				// (vector JSON, not a standard viewable image), 4 = GIF.
				// GIF-format stickers are served from the media proxy host, not the CDN host.
				const stickerItems = message.stickerItems || message.sticker_items;
				stickerItems?.forEach((sticker, i) => {
					if (!sticker.id) return;
					const formatType = sticker.format_type ?? sticker.formatType;
					const [host, ext] = formatType === 4 ? ["media.discordapp.net", "gif"]
						: formatType === 3 ? ["cdn.discordapp.com", "lottie"]
						: ["cdn.discordapp.com", "png"];

					const url = `https://${host}/stickers/${sticker.id}.${ext}?size=4096`;
					if (!seenUrls.has(url)) {
						seenUrls.add(url);
						urls.push({url, filename: `sticker_${sticker.name || i}_${sticker.id}.${ext}`});
					}
				});

				// Custom emoji used in the message text, e.g. <:name:id> or <a:name:id> (animated).
				// Plain Unicode emoji aren't Discord-hosted files and can't be "saved".
				for (const [, animated, name, id] of message.content?.matchAll(/<(a?):(\w+):(\d+)>/g) || []) {
					const ext = animated ? "gif" : "png";
					const url = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=4096`;
					if (!seenUrls.has(url)) {
						seenUrls.add(url);
						urls.push({url, filename: `emoji_${name}_${id}.${ext}`});
					}
				}

				return urls;
			}

			sanitizeFilename(filename) {
				// Strip characters illegal on Windows (and control characters), then trim
				let sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
				// Windows doesn't allow filenames to end in a dot or space
				sanitized = sanitized.replace(/[. ]+$/, "") || "file";

				// Windows reserves these device names even with an extension (e.g. "con.png")
				const nameOnly = sanitized.split(".")[0];
				if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i.test(nameOnly)) {
					sanitized = `_${sanitized}`;
				}

				// Keep the filename short enough to stay under Windows' ~260 char path limit
				const maxLength = 200;
				if (sanitized.length > maxLength) {
					const ext = path.extname(sanitized);
					const stem = sanitized.slice(0, sanitized.length - ext.length);
					sanitized = stem.slice(0, Math.max(1, maxLength - ext.length)) + ext;
				}

				return sanitized;
			}

			getUniqueFilename(filename, usedNames) {
				// Avoid collisions between files in this batch (same name in one message),
				// files already on disk (usedNames is seeded from a directory snapshot, see
				// getReservedNames), and files still being written by another overlapping
				// saveAllFiles() call (usedNames is shared across calls for a given savePath).
				const sanitized = this.sanitizeFilename(filename);
				const ext = path.extname(sanitized);
				const base = sanitized.slice(0, sanitized.length - ext.length);

				let candidate = sanitized;
				let counter = 1;
				while (usedNames.has(candidate.toLowerCase())) {
					candidate = `${base} (${counter})${ext}`;
					counter++;
				}

				usedNames.add(candidate.toLowerCase());
				return candidate;
			}

			// Returns the shared, cross-call name-reservation Set for a save folder, seeding
			// it from a one-time directory listing the first time this path is seen (instead
			// of a blocking fs.existsSync stat per candidate name, every file, every save).
			async getReservedNames(savePath) {
				const key = savePath.toLowerCase();
				let names = this.reservedNames.get(key);
				if (!names) {
					names = new Set();
					try {
						const entries = await new Promise((resolve, reject) => {
							fs.readdir(savePath, (error, files) => error ? reject(error) : resolve(files));
						});
						for (const entry of entries) names.add(entry.toLowerCase());
					} catch {
						// Folder may not exist yet (it's created just before this is called)
						// or isn't readable — fall back to an empty snapshot.
					}
					this.reservedNames.set(key, names);
				}
				return names;
			}

			async saveAllFiles(fileUrls) {
				if (!fileUrls || fileUrls.length === 0) {
					BdApi.UI.showToast("No files found in this message", {type: "info", timeout: 2000});
					return;
				}

				const savePath = this.getSavePath();
				if (!savePath?.trim()) {
					BdApi.UI.showToast("Please set a save folder path in plugin settings", {type: "error", timeout: 3000});
					return;
				}

				// Create the folder if it doesn't exist. mkdir with recursive:true is a
				// no-op (not an error) if it already exists, so no existsSync pre-check is
				// needed. Uses the callback form (fs.promises isn't available in this
				// plugin's sandbox) so a slow/unreachable network save path can't block
				// the renderer thread.
				try {
					await new Promise((resolve, reject) => {
						fs.mkdir(savePath, { recursive: true }, error => error ? reject(error) : resolve());
					});
				} catch (error) {
					BdApi.UI.showToast("Failed to create folder: " + error.message, {type: "error", timeout: 3000});
					return;
				}

				// When overwriting, every same-named file resolves to the same destination path.
				// When not, each one gets a unique "(1)", "(2)"... suffix instead. usedNames is
				// shared across overlapping saveAllFiles() calls (this.reservedNames, keyed by
				// savePath) so two saves triggered close together can't both claim the same
				// "unique" name for the same folder.
				const overwriteExisting = this.getSetting("overwriteExisting", true);
				const usedNames = overwriteExisting ? null : await this.getReservedNames(savePath);
				const resolveDestPath = filename => overwriteExisting
					? path.join(savePath, this.sanitizeFilename(filename))
					: path.join(savePath, this.getUniqueFilename(filename, usedNames));

				// Download files concurrently (bounded, see runWithConcurrency) for speed.
				// Files that land on the same destination path are queued to run one after
				// another instead of concurrently, so the last one cleanly overwrites the
				// rest rather than corrupting it via simultaneous writes to the same path.
				// With overwrite off this is a no-op since every resolved path is already unique.
				// pathQueues is shared across calls (this.pathQueues) for the same reason.
				const pathQueues = this.pathQueues;
				const queueDownload = (url, destPath) => {
					const previous = pathQueues.get(destPath) || Promise.resolve();
					const run = previous.catch(() => {}).then(() => this.downloadFile(url, destPath)).catch(error => {
						// The write never landed, so free up this filename slot (if reserved)
						// for a retry or an unrelated future save instead of burning it forever.
						if (usedNames) usedNames.delete(path.basename(destPath).toLowerCase());
						throw error;
					}).finally(() => {
						// Only clear if a newer call hasn't already queued onto this same path.
						if (pathQueues.get(destPath) === run) pathQueues.delete(destPath);
					});
					pathQueues.set(destPath, run);
					return run;
				};

				const results = await this.runWithConcurrency(
					fileUrls,
					SaveAllFiles.MAX_CONCURRENT_DOWNLOADS,
					({url, filename}) => queueDownload(url, resolveDestPath(filename))
				);

				let savedCount = 0, failedCount = 0;
				results.forEach((result, index) => {
					if (result.status === "fulfilled") {
						savedCount++;
					} else {
						failedCount++;
						console.error(`[SaveAllFiles] Failed to save ${fileUrls[index].filename}:`, result.reason);
					}
				});

				const showFolderLink = this.settings.general.showFolderLink !== undefined ? this.settings.general.showFolderLink : false;
				
				const createFolderLink = (savePath) => {
					const link = document.createElement("a");
					link.textContent = savePath;
					link.setAttribute("data-saveallfiles-link", "true");
					link.href = "#";
					link.style.cssText = "color: var(--text-link) !important; cursor: pointer !important; text-decoration: underline !important; display: inline !important; pointer-events: auto !important; position: relative !important; z-index: 9999 !important;";
					
					const handleClick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						e.stopImmediatePropagation();
						shell.openPath(savePath);
						return false;
					};
					
					link.addEventListener("click", handleClick, true);
					link.addEventListener("mousedown", (e) => {
						e.stopPropagation();
						e.stopImmediatePropagation();
					}, true);
					
					return link;
				};
				
				const addFolderLink = (savePath, messageText) => {
					// Inject a clickable folder link into the toast notification
					let linkAdded = false;
					let timeout, entry;
					const searchText = messageText.split("(")[0].trim();

					const cleanup = () => {
						clearTimeout(timeout);
						let index = this.pendingFolderLinks.indexOf(entry);
						if (index > -1) this.pendingFolderLinks.splice(index, 1);
						if (this.pendingFolderLinks.length === 0) this.teardownSharedObserver();
						index = this.activeTimeouts.indexOf(timeout);
						if (index > -1) this.activeTimeouts.splice(index, 1);
					};

					// Only check text nodes within a given subtree, instead of re-scanning
					// the whole document every time something changes
					const tryAddLink = (root) => {
						if (linkAdded || !root.nodeType) return false;

						// Cheap whole-subtree pre-check: textContent already concatenates all
						// descendant text in one native call, so unrelated DOM churn (message
						// rows, reactions, badges, etc. — Discord's DOM mutates constantly) is
						// rejected without paying for a TreeWalker + per-node scan of subtrees
						// that plainly can't contain the toast text.
						if (!root.textContent?.includes(searchText)) return false;

						const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
						let node = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode();

						while (node) {
							if (node.textContent?.trim().includes(searchText)) {
								let parent = node.parentElement;
								while (parent && parent !== document.body) {
									const classes = parent.className || "";
									const isToast = classes.includes("toast") || classes.includes("notice") ||
									                parent.style.position === "fixed" || parent.style.position === "absolute";

									// (No "does a link already exist here" check: linkAdded plus the
									// early return below already guarantee at most one insertion per
									// call, and checking here would also wrongly skip a valid insertion
									// point just because some other, older toast's link is still elsewhere
									// in the DOM.)
									if (isToast || parent.children.length <= 3) {
										const textParent = node.parentElement;
										if (textParent) {
											textParent.appendChild(document.createTextNode(" to "));
											textParent.appendChild(createFolderLink(savePath));
											linkAdded = true;
											return true;
										}
									}
									parent = parent.parentElement;
								}
							}
							node = root.nodeType === Node.TEXT_NODE ? null : walker.nextNode();
						}
						return false;
					};

					// entry is registered with the shared observer (see ensureSharedObserver)
					// instead of each call spinning up its own document-wide observer.
					entry = {tryAddLink, cleanup};

					// The toast may already be in the DOM by the time we get here
					if (tryAddLink(document.body)) return;

					this.pendingFolderLinks.push(entry);
					this.ensureSharedObserver();

					// Safety net: give up after 2s if no matching toast ever appeared
					timeout = setTimeout(cleanup, 2000);
					this.activeTimeouts.push(timeout);
				};
				
				const showToast = (message, type, timeout) => {
					BdApi.UI.showToast(message, {type, timeout});
					if (showFolderLink) addFolderLink(savePath, message);
				};
				
				if (savedCount > 0 && failedCount === 0) {
					showToast(`Successfully saved ${savedCount} file(s)`, "success", showFolderLink ? 5000 : 3000);
				} else if (savedCount > 0) {
					showToast(`Saved ${savedCount} file(s), ${failedCount} failed`, "warning", showFolderLink ? 5000 : 3000);
				} else {
					BdApi.UI.showToast(`Failed to save files`, {type: "error", timeout: 3000});
				}
			}

			// Runs `worker` over `items` with at most `limit` in flight at once, returning
			// Promise.allSettled-shaped results in the original item order. Videos are read
			// fully into memory before being written to disk, so an uncapped Promise.all
			// over a message with several large attachments could spike memory/network;
			// this keeps that bounded regardless of how many files a message contains.
			async runWithConcurrency(items, limit, worker) {
				const results = new Array(items.length);
				let next = 0;

				const runNext = async () => {
					while (next < items.length) {
						const index = next++;
						try {
							results[index] = {status: "fulfilled", value: await worker(items[index], index)};
						} catch (reason) {
							results[index] = {status: "rejected", reason};
						}
					}
				};

				await Promise.all(Array.from({length: Math.min(limit, items.length)}, runNext));
				return results;
			}

			// One MutationObserver shared by every pending "add folder link to toast" request,
			// instead of each saveAllFiles() call spinning up its own document.body-wide
			// observer — saving files from several messages in quick succession would
			// otherwise stack up N independent observers all reacting to the same DOM churn.
			ensureSharedObserver() {
				if (this.sharedObserver) return;
				this.sharedObserver = new MutationObserver(mutations => {
					for (const mutation of mutations) {
						for (const added of mutation.addedNodes) {
							// Iterate backwards since a match's cleanup() splices its entry
							// out of pendingFolderLinks mid-loop.
							for (let i = this.pendingFolderLinks.length - 1; i >= 0; i--) {
								if (this.pendingFolderLinks[i].tryAddLink(added)) {
									this.pendingFolderLinks[i].cleanup();
								}
							}
						}
					}
				});
				this.activeObservers.push(this.sharedObserver);
				this.sharedObserver.observe(document.body, { childList: true, subtree: true });
			}

			teardownSharedObserver() {
				if (!this.sharedObserver) return;
				this.sharedObserver.disconnect();
				const index = this.activeObservers.indexOf(this.sharedObserver);
				if (index > -1) this.activeObservers.splice(index, 1);
				this.sharedObserver = null;
			}

			async downloadFile(url, filePath) {
				const response = await BdApi.Net.fetch(url, {redirect: "follow"});
				if (!response.ok) throw new Error(`Failed to download: HTTP ${response.status}`);

				// Uint8Array instead of Buffer since BD deprecated the Buffer global in
				// favor of web-standard typed arrays.
				const data = new Uint8Array(await response.arrayBuffer());
				try {
					// BetterDiscord's plugin sandbox doesn't expose fs.promises (or
					// require("stream")) — but the callback-based fs.writeFile is a plain
					// property of the same fs module already used for the library-downloader
					// fallback near the top of this file, and is unaffected by that
					// restriction. Using it here (instead of fs.writeFileSync) keeps large
					// writes, e.g. video attachments, off the renderer's UI thread.
					await new Promise((resolve, reject) => {
						fs.writeFile(filePath, data, error => error ? reject(error) : resolve());
					});
				} catch (error) {
					// Don't leave a truncated/corrupt file behind on a failed write.
					// Swallow cleanup failures so they don't mask the original error.
					await new Promise(resolve => fs.unlink(filePath, () => resolve()));
					throw error;
				}
			}
		};
	})(window.BDFDB_Global.PluginUtils.buildPlugin({}));
})();