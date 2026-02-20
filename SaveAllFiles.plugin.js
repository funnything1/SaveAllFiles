/**
 * @name SaveAllFiles
 * @author funnything1
 * @version 1.0.0
 * @description Allows you to download all files from a message to a folder at once without prompts
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
			onLoad () {
				this.defaults = {
					general: {
						savePath: {value: ""},
						menuPosition: {value: "after-copy"},
						buttonLabel: {value: "Save All Files"},
						showFolderLink: {value: false}
					}
				};
				// Track active observers and timeouts for cleanup
				this.activeObservers = [];
				this.activeTimeouts = [];
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
				if (saved && typeof saved === "string") return saved;
				return this.settings.general[key]?.value !== undefined ? this.settings.general[key].value : defaultValue;
			}

			loadSettings() {
				this.settings.general.savePath = this.getSetting("savePath", "");
				this.settings.general.menuPosition = this.getSetting("menuPosition", "after-copy");
				this.settings.general.buttonLabel = this.getSetting("buttonLabel", "Save All Files");
				this.settings.general.showFolderLink = this.getSetting("showFolderLink", false);
			}

			saveSettings() {
				BDFDB.DataUtils.save(this.getSavePath(), this, "savePath");
				BDFDB.DataUtils.save(this.settings.general.menuPosition, this, "menuPosition");
				BDFDB.DataUtils.save(this.settings.general.buttonLabel, this, "buttonLabel");
				BDFDB.DataUtils.save(this.settings.general.showFolderLink, this, "showFolderLink");
			}

			getMenuPosition(returnValue) {
				// Figure out where to insert the menu item based on user preference
				const pos = this.settings.general.menuPosition || "after-copy";
				const configs = {
					"after-copy": {id: ["copy-text", "pin", "unpin"], offset: 1},
					"after-edit": {id: ["edit", "add-reaction", "add-reaction-1", "quote"], offset: 1},
					"before-copy": {id: ["copy-text", "pin", "unpin"], offset: 0},
					"top": {id: [], offset: 0},
					"bottom": {id: [], offset: -1}
				};
				
				const config = configs[pos] || configs["after-copy"];
				if (config.id.length === 0) {
					// Top or bottom positioning - just find the menu container
					const [children] = BDFDB.ContextMenuUtils.findItem(returnValue, {id: []}) || [returnValue];
					return [children || returnValue, pos === "top" ? 0 : (children || returnValue).length];
				}
				
				// Try to find the target menu item to position relative to
				const result = BDFDB.ContextMenuUtils.findItem(returnValue, {id: config.id});
				if (result?.[0] && result[1] >= 0) return [result[0], result[1] + config.offset];
				
				// Fallback to common menu items if the preferred one isn't found
				const fallback = BDFDB.ContextMenuUtils.findItem(returnValue, {id: ["copy-text", "pin", "unpin"]}) ||
				                 BDFDB.ContextMenuUtils.findItem(returnValue, {id: ["edit", "add-reaction", "add-reaction-1", "quote"]}) ||
				                 [returnValue, -1];
				return [fallback[0] || returnValue, fallback[1] >= 0 ? fallback[1] + 1 : 0];
			}

			getSettingsPanel () {
				const currentPath = this.getSavePath();
				const menuPos = this.settings.general.menuPosition || "after-copy";
				const buttonLabel = this.settings.general.buttonLabel || "Save All Files";
				const showFolderLink = this.getSetting("showFolderLink", false);
				
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
									this.saveSettings();
									BDFDB.ReactUtils.forceUpdate(this);
								}
							})
						}),
						currentPath && fs.existsSync(currentPath) && BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.Clickable, {
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
									this.saveSettings();
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
									this.saveSettings();
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
									this.saveSettings();
									BDFDB.ReactUtils.forceUpdate(this);
								}
							})
						})
					].filter(n => n)
				});
			}

			onMessageContextMenu (e) {
				const message = e.instance?.props?.message;
				if (!message || (!message.attachments?.length && !message.embeds?.some(e => e.image?.url || e.thumbnail?.url || e.video?.url))) return;
				
				let [children, index] = BDFDB.ContextMenuUtils.findItem(e.returnvalue, {id: ["copy-text", "pin", "unpin"]});
				if (index == -1) {
					[children, index] = BDFDB.ContextMenuUtils.findItem(e.returnvalue, {id: ["edit", "add-reaction", "add-reaction-1", "quote"]});
				}
				
				if (this.settings.general.menuPosition && this.settings.general.menuPosition !== "after-copy") {
					const custom = this.getMenuPosition(e.returnvalue);
					if (custom[0]) [children, index] = custom;
				}
				
				if (children) {
					children.splice(index > -1 ? index + 1 : 0, 0, BDFDB.ContextMenuUtils.createItem(BDFDB.LibraryComponents.MenuItems.MenuItem, {
						label: this.settings.general.buttonLabel || "Save All Files",
						id: BDFDB.ContextMenuUtils.createItemId(this.name, "save-all-files"),
						icon: _ => BDFDB.ReactUtils.createElement(BDFDB.LibraryComponents.MenuItems.MenuIcon, {icon: saveIcon}),
						action: _ => this.saveAllFiles(message)
					}));
				}
			}
			
			getAllFileUrls(message) {
				// Collect all downloadable files from attachments and embeds
				const urls = [];
				const timestamp = Date.now();
				
				// Get direct file attachments
				message.attachments?.forEach((att, i) => {
					const url = att.url || att.proxy_url || att.proxyUrl;
					if (url) urls.push({url, filename: att.filename || att.name || `file_${i}_${timestamp}`});
				});
				
				// Extract images/videos from embeds (they don't have filenames by default)
				message.embeds?.forEach((embed, i) => {
					const getUrl = obj => obj?.proxy_url || obj?.proxyUrl || obj?.url;
					const getExt = url => url?.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1]?.toLowerCase();
					
					if (embed.image?.url) {
						const url = getUrl(embed.image);
						urls.push({url, filename: `embed_image_${i}_${timestamp}.${getExt(url) || "png"}`});
					}
					if (embed.thumbnail?.url) {
						const url = getUrl(embed.thumbnail);
						urls.push({url, filename: `embed_thumbnail_${i}_${timestamp}.${getExt(url) || "png"}`});
					}
					if (embed.video?.url) {
						const url = getUrl(embed.video);
						urls.push({url, filename: `embed_video_${i}_${timestamp}.${getExt(url) || "mp4"}`});
					}
				});
				
				return urls;
			}

			sanitizeFilename(filename) {
				return filename.replace(/[<>:"/\\|?*]/g, "_").trim();
			}

			async saveAllFiles(message) {
				const savePath = this.getSavePath();
				if (!savePath?.trim()) {
					BdApi.UI.showToast("Please set a save folder path in plugin settings", {type: "error", timeout: 3000});
					return;
				}

				// Create the folder if it doesn't exist
				if (!fs.existsSync(savePath)) {
					try {
						fs.mkdirSync(savePath, { recursive: true });
					} catch (error) {
						BdApi.UI.showToast("Failed to create folder: " + error.message, {type: "error", timeout: 3000});
						return;
					}
				}

				const fileUrls = this.getAllFileUrls(message);
				if (fileUrls.length === 0) {
					BdApi.UI.showToast("No files found in this message", {type: "info", timeout: 2000});
					return;
				}

				// Download all files in parallel and track successes/failures
				const results = await Promise.allSettled(
					fileUrls.map(({url, filename}) => 
						this.downloadFile(url, path.join(savePath, this.sanitizeFilename(filename)))
					)
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
					const searchText = messageText.split("(")[0].trim();
					
					const tryAddLink = () => {
						if (linkAdded) return false;
						
						// Search through the DOM to find the toast notification text
						const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
						let node;
						
						while (node = walker.nextNode()) {
							if (!node.textContent?.trim().includes(searchText)) continue;
							
							let parent = node.parentElement;
							while (parent && parent !== document.body) {
								const classes = parent.className || "";
								const isToast = classes.includes("toast") || classes.includes("notice") || 
								                parent.style.position === "fixed" || parent.style.position === "absolute";
								
								if ((isToast || parent.children.length <= 3) && !parent.querySelector("a[data-saveallfiles-link]")) {
									const textParent = node.parentElement;
									if (textParent) {
										const textNode = document.createTextNode(" to ");
										textParent.appendChild(textNode);
										textParent.appendChild(createFolderLink(savePath));
										linkAdded = true;
										return true;
									}
								}
								parent = parent.parentElement;
							}
						}
						return false;
					};
					
					// Watch for DOM changes and try multiple times since toasts appear asynchronously
					const observer = new MutationObserver(() => {
						if (tryAddLink()) {
							observer.disconnect();
							const index = this.activeObservers.indexOf(observer);
							if (index > -1) this.activeObservers.splice(index, 1);
						}
					});
					
					this.activeObservers.push(observer);
					observer.observe(document.body, { childList: true, subtree: true });
					
					[0, 100, 300, 500, 2000].forEach(delay => {
						const timeout = setTimeout(() => {
							if (tryAddLink() || delay === 2000) {
								observer.disconnect();
								const index = this.activeObservers.indexOf(observer);
								if (index > -1) this.activeObservers.splice(index, 1);
							}
							const timeoutIndex = this.activeTimeouts.indexOf(timeout);
							if (timeoutIndex > -1) this.activeTimeouts.splice(timeoutIndex, 1);
						}, delay);
						this.activeTimeouts.push(timeout);
					});
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

			async downloadFile(url, filePath) {
				// Fetch the file and save it to disk
				const response = await BdApi.Net.fetch(url, {redirect: "follow"});
				if (!response.ok) throw new Error(`Failed to download: HTTP ${response.status}`);
				fs.writeFileSync(filePath, new Uint8Array(await response.arrayBuffer()));
			}
		};
	})(window.BDFDB_Global.PluginUtils.buildPlugin({}));
})();