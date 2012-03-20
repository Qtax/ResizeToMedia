"use strict";

var resized_to_elem;
var orig_size;
var orig_scroll;
var disabled_fixed;
var last_detected_zoom;

var resize_returned;


(function(){
	if(window != top){
		console.warn("ResizeToMedia: Content script not in top frame, returning");
		return;
	}
	
	if(resized_to_elem)
		undoResize();
	else
		resizeToMedia();
})();




/**------------------------------------------------------------------
/** resizeToMedia()
/**------------------------------------------------------------------
/* Main function, finds and resizes window to media element.
*/

function resizeToMedia(second_call){
	// second_call is true when doing the resize of the compact popout window.
	// It is needed because the compact popup window border sizes are unknown
	// before hand (or at least I haven't found a way to get them).
	// TODO: maybe those never change? research that.
	
	var elem;
	var path;
	var z;
	
	if(second_call){
		path = resized_to_elem;
		elem = path[path.length-1];
		z = last_detected_zoom;
	}
	else{
		path = findMaxElem();
		
		if(!path || path.length < 1)
			return;
		
		resized_to_elem = path;
		elem = path[path.length-1];
		
		
		orig_size = {
			width: window.outerWidth,
			height: window.outerHeight
		};
		
		document.body.style.setProperty("overflow", "hidden");
		
		// zoom
		z = detectZoom();
		last_detected_zoom = z;
		
		console.info("ResizeToMedia: Max size element found: " + elem + ", " + elem.clientWidth + "x" + elem.clientHeight + ". Zoom: " + z);
	}
	
	
	
	// compute window size
	
	var data = {
		width: Math.round(elem.clientWidth * z)
			+ (window.outerWidth - Math.round(window.innerWidth * z)),
		height:	Math.round(elem.clientHeight * z)
			+ (window.outerHeight - Math.round(window.innerHeight * z)),
		
		to_media: true,
		second_call: second_call
	};
	
	
	// resize window
	
	chrome.extension.sendRequest(data, function(dat){
	
		if(!second_call){
			resize_returned = dat;
			
			orig_scroll = scrollToTop(path);
			disabled_fixed = disableFixed();
			
			// if window type is "popup" resize again
			if(dat.compact && !dat.already_popout){
				resizeToMedia(true);
				return;
			}
		}
		else{
			// restore dat on 2nd call
			dat = resize_returned;
		}
		
		if(dat.restore_on_unload || dat.navigate_reapply){
			// resize window when navigating away from page
			window.onbeforeunload = function(){ undoResize("unload"); };
		}
		
		if(dat.restore_on_resize){
			// small delay so that the resize event can fully propagate first
			setTimeout(function(){
				// don't assign directly so that the resize event is not passed to it.
				window.onresize = function(){
					// dont resize if not a compact window
					if(!dat.compact)
						orig_size = null;
					
					undoResize();
				};
			}, 100);
		}
	});
}




/**------------------------------------------------------------------
/** undoResize()
/**------------------------------------------------------------------
/* unload: true when triggered by unload event.
*/

function undoResize(unload){
	if(!resized_to_elem)
		return;
	
	console.info("ResizeToMedia: undo resize. Unload: " + unload);
	
	resized_to_elem = null;
	window.onbeforeunload = null;
	window.onresize = null;
	
	// skip if unloading
	if(!unload){
		document.body.style.removeProperty("overflow");
		
		restore(disabled_fixed, true);
		disabled_fixed = null;
	}
	
	// resize
	if(orig_size){
		resize_returned.to_media = false;
		resize_returned.restore = true;
		resize_returned.unload = unload;
		
		chrome.extension.sendRequest(resize_returned, function(response){
			if(!unload) restore(orig_scroll);
			orig_scroll = null;
		});
	}
	else if(!unload){
		// restore but dont scroll
		delete orig_scroll.top;
		delete orig_scroll.left;
		restore(orig_scroll);
		orig_scroll = null;
	}
}







/**------------------------------------------------------------------
/** findMaxElem()
/**------------------------------------------------------------------
*/

function findMaxElem(){
    var max_elem = null;
    var max_path = null;
    var max_size = 0;
    
    var elems = [];
    
    // query element in all frames
    
    var docs = [ [document] ];
    
    for(var i = 0; i < docs.length; ++i){
        var current = docs[i]; // = [document, iframe, iframe, ...]
        var doc = current.shift();
        if(!doc) continue;
        
        //console.log("** searching doc: " + doc.location.href);
        
        // push document from frames, with path
        var frames = doc.querySelectorAll("iframe");
        for(var f = 0; f < frames.length; ++f){
			if(!isVisible(frames[f], doc)) continue;
            docs.push([frames[f].contentDocument].concat(current, frames[f]));
		}
        
        // get elements with path
        var nodes = doc.querySelectorAll("embed, object, video, img, canvas");
        // note: elems.concat(nodes) doesn't work on "#<NodeList>", zzz
        for(var j = 0; j < nodes.length; ++j){
			if(!isVisible(nodes[j], doc)) continue;
            elems.push([nodes[j], current]);
		}
    }
    
    //console.log("** total elems found: " + elems.length);
    
    
    for(var i = 0; i < elems.length; i++){
        var elem = elems[i][0];
        var path = elems[i][1];
        
        var w = elem.clientWidth || 0;
        var h = elem.clientHeight || 0;
        
        //console.log(" * elem: " + w + " x " + h);
        //console.log(elem);
        //console.log(" * path: " + path.length)
        //console.log(path);
        //console.log(path[0]);
        
        var size = w * h;
        
        // skip if too small
        if(w < 150 || h < 120 || size < 200*200) continue;
        
        // weighting
        
        var r = h/w >= 1 ? h/w : w/h;
        if(r >= 2.2) size *= 0.5;
        if(r >= 4) size *= 0.5;
        
        //if(elem.tagName == "IMG") size *= 0.7;
        
        
        if(size <= max_size)
            continue;
        
        max_size = size;
        max_elem = elem;
        max_path = path;
        
    }
    
    if(!max_elem)
        return;

    max_path.push(max_elem);
    return max_path;
}





/**------------------------------------------------------------------
/** scrollToTop()
/**------------------------------------------------------------------
*/

function scrollToTop(elem, doc, prevRes){
    if(!elem) return;
    
	//console.log("* scrollToTop(" + elem + ", " + doc + ", " + prevRes + ")");
	//console.log(elem);
	//console.log(doc);
	
    // input elem can be an array of scrollable elements, a path:
    // [iframe, iframe, video]
    if(isArray(elem)){
		var first = elem[0];
		if(!first) return [];
		
		var rest = elem.slice(1);
		var docFirst = doc;
		
        if(first.tagName.toLowerCase() === "iframe")
            doc = first.contentDocument;
        
		// scroll inner elements first to accumulate scroll diff (.diffTop, .diffLeft)
        var restRestore = scrollToTop(rest, doc);
		
		// now scroll the outer elem with the accumulated scroll diff
        var restore = scrollToTop(first, docFirst, restRestore[0]);
        
        return [restore].concat(restRestore);
    }
    
    if(!doc){
		doc = document;
	}
    
    var top = 0;
    var left = 0;
    
    if(prevRes){
        //console.log("* prev: " + prevRes.diffLeft);
        //console.log(prevRes);
        
        top += prevRes.diffTop;
        left += prevRes.diffLeft;
    }
    
	
    var restore = {
        left: doc.body.scrollLeft,
        top: doc.body.scrollTop,
        diffLeft: 0,
        diffTop: 0,
        document: doc,
        styles: []
    };
    
    //console.log("* scroll to elem:");
    //console.log(elem);
    
    do{
        //console.log(elem);
        //console.log("top: " + elem.offsetTop + ", left: " + elem.offsetLeft);
        var pos = getStyle(elem, 'position', doc);
        //console.log('pos: ' + pos);
        
		/*
        if(pos == "fixed"){
            restore.styles.push([elem, elem.style.cssText]);
            elem.style.setProperty('position', 'absolute', 'important');
        }
        */
		
		// dont bother with body
		// else overflow hidden will be reset
		if(elem != document.body){
			restore.styles.push([elem, elem.style.cssText]);
			
			if(getStyle(elem, 'position', doc) == "fixed")
				elem.style.setProperty('position', 'absolute', 'important');
			
			// set positions as important so that scripts do not reset them
			elem.style.setProperty('left', getStyle(elem, 'left', doc) + "px", 'important');
			elem.style.setProperty('top', getStyle(elem, 'top', doc) + "px", 'important');
			elem.style.setProperty('right', getStyle(elem, 'right', doc) + "px", 'important');
			elem.style.setProperty('bottom', getStyle(elem, 'bottom', doc) + "px", 'important');
		}
		
		
        top += elem.offsetTop || 0;
        left += elem.offsetLeft || 0;
        
        top += getStyle(elem, 'border-top-width', doc) || 0;
        left += getStyle(elem, 'border-left-width', doc) || 0;
    }
    while (elem = elem.offsetParent);
    
	// scroll
	doc.body.scrollLeft = left;
	doc.body.scrollTop = top;
	
	// pass on the diff
    restore.diffLeft = left - doc.body.scrollLeft;
    restore.diffTop = top - doc.body.scrollTop;
	
	//console.log("  scroll to: " + left + "," + top + " got to: " + doc.body.scrollLeft + "," + doc.body.scrollTop + "  diff: " + restore.diffLeft + "," + restore.diffTop)
    
    return restore;
}






/**------------------------------------------------------------------
/** disableFixed()
/**------------------------------------------------------------------
*/

function disableFixed(){
	var restore = {
		styles: []
	};
	
	var elems = document.querySelectorAll("*");
	for(var i = 0; i < elems.length; ++i){
		var elem = elems[i];
		var pos = getStyle(elem, 'position');
        
		if(pos != "fixed") continue;
		
		// skip full covering floats, those are probably under the video anyway
		// eg IMDB: play trailer, resize to media, (fixed overlay gets disabled),
		// trailer finnishes and closes removes overlay, click to restore size,
		// bg overlay gets restored again(!) to cover whole page.
		if (getStyle(elem, 'width') == window.innerWidth &&
			getStyle(elem, 'height') == window.innerHeight)
			continue;
		
        restore.styles.push([elem, elem.style.cssText]);
        elem.style.setProperty('display', 'none', 'important');
	}
	
	return restore;
}




/**------------------------------------------------------------------
/** restore()
/**------------------------------------------------------------------
*/

function restore(res, hidden){
    if(!res) return;
    
    if(isArray(res)){
        for(var i = 0; i < res.length; ++i){
            restore(res[i], hidden);
        }
        return;
    }
    
    for(var i = 0; res.styles && i < res.styles.length; ++i){
        var dat = res.styles[i];
		var elem = dat[0];
		var style = dat[1];
		if(hidden || isVisible(elem, res.document))
			elem.style.cssText = style;
    }
    
    if(typeof res.left === "number" && typeof res.top === "number"){
        var doc = res.document || document;
		
		doc.body.scrollLeft = res.left;
		doc.body.scrollTop = res.top;
    }
}









/******************************************************************************
/***
/*** Helper functions
/***
/*****************************************************************************/



/**------------------------------------------------------------------
/** isArray()
/**------------------------------------------------------------------
*/

function isArray(obj){
    return Object.prototype.toString.call(obj) === "[object Array]";
}



/**------------------------------------------------------------------
/** getStyle()
/**------------------------------------------------------------------
*/

function getStyle(elem, property, doc){
    if(!doc) doc = document;
    if(typeof elem === "string") elem = doc.querySelector(elem);
    if(!elem) return;
	
	//console.log("getStyle(" + elem + ", " + property + ", " + doc + ")");
	
	var win = doc.defaultView || window; // try with our window anyway
	// CHROME BUG: extension cant access window object of frames
	// http://code.google.com/p/chromium/issues/detail?id=20773
	//if(!win) return;
	
	var comp = win.getComputedStyle(elem, null);
	if(!comp){
		console.warn("ResizeToMedia: getStyle(): can't get style of element (due to a chrome bug if the element is in another frame). Elem: " + elem + ", prop: " + property);
		return;
	}
	
	var val = comp.getPropertyValue(property);
    if(!val) return val;
    
	// convert pixels to numbers
    if(val.substr(-2) === "px"){
        var str = val.substr(0, val.length-2);
        var num = parseInt(str, 10);
        if(num == str) return num;
    }
    
    return val;
}



/**------------------------------------------------------------------
/** isVisible()
/**------------------------------------------------------------------
/* Returns true if the element is visible.
*/

function isVisible(elem, doc){
	if(!elem) return;
	if(!doc) doc = document;
	
	if(getStyle(elem, 'display', doc) == "none"
		|| getStyle(elem, 'width', doc) < 1
		|| getStyle(elem, 'height', doc) < 1
		|| getStyle(elem, 'visibility', doc) == "hidden"
		|| getStyle(elem, 'opacity', doc) < 0.01
	){
		return false;
	}
	
	return true;
}



/**------------------------------------------------------------------
/** detectZoom()
/**------------------------------------------------------------------
/* Hack to detect zoom scale.
*/

// From https://github.com/yonran/detect-zoom/
// Andreas Zetterlund:
// - Minor changes: words replaced by numbers, width not set

function detectZoom(){
	// the trick: an element's clientHeight is in CSS pixels, while you can
	// set its line-height in system pixels using font-size and
	// -webkit-text-size-adjust:none.
	// device-pixel-ratio: http://www.webkit.org/blog/55/high-dpi-web-sites/
	
	var container = document.createElement('div');
	var div = document.createElement('div');

	// if width is set low, words of more than 1 char can be broken up
	// to span several lines (with some CSS settings)
	container.setAttribute("style", "height: 0; overflow: hidden; visibility: hidden; position: absolute; top: 0; left: 0;");
	div.innerHTML = "1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>0";
	div.setAttribute("style", "font: 100px/1em sans-serif; -webkit-text-size-adjust: none;");
	
	container.appendChild(div);
	document.body.appendChild(container);
	
	var r = 1000 / div.clientHeight;
	document.body.removeChild(container);
	
	return r;
}





