"use strict";


chrome.browserAction.onClicked.addListener(function(tab) {
	chrome.tabs.executeScript(null, { file: "content.js" });
});

chrome.tabs.onUpdated.addListener(function(tabId, info, tab){
	if(reapply_tabs[tabId] && info.status == "complete"){
	//~ if(reapply_tabs[tabId] && info.status == "loading"){
		//~ console.log("*** onUpdated: " + tabId + " status: " + info.status);
		//console.log(info);
		//console.log(tab);
		
		reapply_exec[tabId] = reapply_tabs[tabId];
		delete reapply_tabs[tabId];
		
		chrome.tabs.executeScript(tabId, { file: "content.js" });
	}
});

var reapply_tabs = {};
var reapply_exec = {};


chrome.extension.onRequest.addListener(
	function(dat, sender, sendResponse){
		var tab = sender.tab;
		
		//~ console.log("#### request:");
		//~ console.log(dat);
		
		chrome.tabs.query({ windowId: tab.windowId }, function(tabs){
			
			// when compact & unload: dont resize
			if(conf.get('navigate_reapply') && dat.unload && dat.compact){
				//~ console.log("re-apply unload. data cached");
				reapply_tabs[tab.id] = dat;
				return;
			}
			
			// resize to media element
			if(dat.to_media){
				var w = dat.width;
				var h = dat.height;
				
				var popout = conf.get('compact_always')
						  || (conf.get('popout') && tabs.length > 1);
				
				var compact = conf.get('compact_always')
						   || conf.get('popout_compact');
				
				// response param
				var param = {
					popout: popout,
					compact: compact,
					restore_on_resize: conf.get('restore_on_resize'),
					restore_on_unload: conf.get('restore_on_unload'),
					navigate_reapply: conf.get('navigate_reapply')
				};
				
				
				// get window info
				chrome.windows.get(tab.windowId, function(win){
					// pass current window info
					param.orig_win = win;
					
					if(win.type != "normal" && !dat.second_call){
						param.already_popout = true;
						
						if(reapply_exec[tab.id])
							param.orig_win = reapply_exec[tab.id].orig_win || win;
						else
							console.error("!!! re-apply but no data avail");
					}
					
					delete reapply_exec[tab.id];
					delete reapply_tabs[tab.id];
					
					
					// pop-out, do not pop-out if already a popup
					if(popout && !param.already_popout){
						// move tab to new window
						chrome.windows.create({
							tabId: tab.id,
							top: win.top,
							left: win.left,
							width: w,
							height: h,
							focused: true,
							type: (compact? 'popup': 'normal')
							},
							function(win){ if(sendResponse) sendResponse(param); }
						);
					}
					// just resize current window
					else{
						chrome.windows.update(tab.windowId, { width: w, height: h },
							function(win){ if(sendResponse) sendResponse(param); }
						);
					}
				});
			}
			// restore window call
			else{
				//~ console.log("*** restore");
				//~ console.log(dat);
				
				// restore compact window to normal
				if(dat.compact){
					//~ console.log("** compact");
					if(dat.orig_win && dat.orig_win.id){
						//~ console.log("** have orig_win.id:" + dat.orig_win.id);
						
						chrome.windows.get(dat.orig_win.id, function(win){
							//~ console.log("** in window get ");
							//~ console.log(win);
							
							// win found, move tab
							if(win && win.id){
								//~ console.log("** moving tab...");
								
								chrome.tabs.move(tab.id, {
									windowId: dat.orig_win.id,
									index: 9999 // put it last
									},
									function(tab){
										// activate tab
										chrome.tabs.update(tab.id, { active: true });
										if(sendResponse) sendResponse();
									});
							}
							
							// window not found, create new
							else{
								//~ console.log("** creating new window...");
								
								delete dat.orig_win.id;
								delete dat.orig_win.state;
								
								dat.orig_win.tabId = tab.id;
								dat.orig_win.focused = true;
								
								chrome.windows.create(dat.orig_win,
									function(win){ if(sendResponse) sendResponse(); }
								);
							}
						});
					}
				}
				// just resize current window
				else{
					//~ console.log("** plain resize");
					
					var win = dat.orig_win;
					
					delete win.id;
					delete win.state;
					delete win.type;
					delete win.incognito;
					delete win.left;
					delete win.top;
					delete win.focused;
					
					var func;
					if(!dat.unload)
						func = function(win){ if(sendResponse) sendResponse(param); };
					
					// try because window might already be gone
					try{
						chrome.windows.update(tab.windowId, win, func);
					}
					catch(e){ }
				}
				
			}

		});
	}
);



