"use strict";


window.conf = (function(def){
	var self = {};
	
	self.get = function(name){
		if(name in localStorage)
			return JSON.parse(localStorage.getItem(name));
		
		return def[name];
	};
	
	self.set = function(name, val){
		localStorage.setItem(name, JSON.stringify(val));
		return val;
	};
	
	self.reset = function(name){
		if(name === undefined)
			localStorage.clear();
		else
			delete localStorage[name];
	};
	
	
	self.init = function(){
		var ver = chrome.app.getDetails().version;
		
		// clear db if other version
		if(self.get('version') != ver){
			self.reset();
			self.set('version', ver);
		}
	};
	
	self.init();
	
	return self;
})
// config defaults
({
	compact_always: true,
	popout: true,
	popout_compact: true,
	navigate_reapply: true,
	restore_on_resize: true,
	restore_on_unload: true
});

