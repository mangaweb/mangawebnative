global.$ = $;
var fs = require("graceful-fs");
var Promise = require("bluebird");
var async = require("async");
var PDFDocument = require("pdfkit");
var sizeOf = require('image-size');
var request = require("request");
var requestAsync = Promise.promisify(require("request"));
Promise.promisifyAll(request);
Promise.promisifyAll(async);
Promise.promisifyAll(fs);


var convertName = function(name) {
	if (typeof(name) === "string") {
		var newName = name.toLowerCase().replace(/\s/g, "-");
		return newName;
	}
};

var getMangaUrl = function(name) {
	return requestAsync({uri: "http://mangapark.me/manga/" + name, headers: headers})
	.then(function(res) {
		try {
			var id = res[0].body.match(/\_manga\_id\s*\=\s*'(\d+)'/)[1];
			return "http://2.p.mpcdn.net/" + id;
		} catch(e) {
			console.log(e);
		}
	});
};


var headers = {
	'User-Agent': 'MangaWeb'
};
function Download() {

	if (fs.readFileSync("./savelocation").length < 1){

	}
	var options = {reverse: $("#reverse").is(":checked")};
	var progress;
	var jpgsLength;
	var deleteFolderRecursive = function(path) {
	  if( fs.existsSync(path) ) {
	      fs.readdirSync(path).forEach(function(file) {
	        var curPath = path + "/" + file;
	          if(fs.statSync(curPath).isDirectory()) { // recurse
	              deleteFolderRecursive(curPath);
	          } else { // delete file
	              fs.unlinkSync(curPath);
	          }
	      });
	      fs.rmdirSync(path);
	    }
	};

	var leftovers = fs.readdirSync("./manga");
	for (var i = 0; i < leftovers.length; i++) {
		try {
			deleteFolderRecursive("./manga/" + leftovers[i]);
		} catch(e) {
			console.log(e);
		}
	}

	var sortJpgs = function(a, b) {
		var valA = parseInt(a.match(/\/(\d+)\.jpg/)[1]);
		var valB = parseInt(b.match(/\/(\d+)\.jpg/)[1]);
		return valA - valB;
	};

	var downloadImage = function(imgObj, cb) {
		return new Promise(function(resolve, reject) {
			var link = imgObj.link;
			var path = imgObj.path;
			var imgName = link.match(/\d+\.jpg/)[0];
			var req = request({uri: link, headers: headers});
			req.pipe(fs.createWriteStream(path));
			req.on("end", function() {
				cb();
				if (progress >= jpgsLength) {$(".progress-bar").css("width", "0");}
				$(".progress-bar").css("width", ((++progress / jpgsLength) * 100) + "%");
				resolve();
			});
		});
	};

	var getLinks = function(dirUrl) {
		return requestAsync({uri: dirUrl, headers: headers})
		.then(function(res) {
			var links = res[0].body.match(/href="\/?\d+(\/|\.jpg)"/g);
			links = links.map(function(href) {
				href = dirUrl + "/" + href.match(/\d+(\/|\.jpg)/)[0];
				if (href[href.length - 1] === "/") {
					href = href.slice(0, href.length - 1);
				}
				return href;
			});
			return links;
		});
	};


	this.getManga = function(name, callback) {
		console.log("searching");
		var mangaPdf = new PDFDocument();
		var mangaDirPath;
		var mangaQueue = async.queue(downloadImage, 6);
		var jpgLinks = {};
		var mangaUrl;
		var chapters;
		progress = 0;
		$(".progress-bar").css("width", "0%");
		jpgsLength = 0;

		mangaQueue.drain = function() {
			console.log("Generating PDF");
			if (options.reverse) {
				for (var i = chapters.length - 1; i >= 0 ; i--) {
					for (var j = jpgLinks[i].length - 1; j >= 0; j--) {
						var dimensions = sizeOf(jpgLinks[i][j].path);
						mangaPdf
						.addPage({
							size: [dimensions.width, dimensions.height],
							margin: 0
							})
						.image(jpgLinks[i][j].path);
					}
				}
			} else {
				for (var i = 0; i < chapters.length; i++) {
					for (var j = 0; j < jpgLinks[i].length; j++) {
						var dimensions = sizeOf(jpgLinks[i][j].path);
						mangaPdf
						.addPage({
							size: [dimensions.width, dimensions.height],
							margin: 0
							})
						.image(jpgLinks[i][j].path);
					}
				}
			}
			mangaPdf.end();
			console.log("Finished Generating PDF");
			deleteFolderRecursive(mangaDirPath);
			if (callback) callback(fs.readFileSync("./savelocation") + "/" + name + ".pdf");
		};
		getMangaUrl(name)
		.then(function(url) {
			mangaUrl = url;
			mangaDirPath = "./manga/" + name;
			try {
				return fs.mkdirAsync(mangaDirPath);
			} catch(e) {
				console.log(e);
				return;
			}
		})
		.then(function() {
			mangaPdf.pipe(fs.createWriteStream(fs.readFileSync("./savelocation") + "/" +name + ".pdf"));
			mangaPdf.moveDown(25);
			mangaPdf.text(name.replace("-", " "), {
				align: "center"
			});
			return getLinks(mangaUrl);
		})
		.then(function(links) {
			chapters = links;
			return async.mapAsync(links, function(link, cb) {
				var chapterNum = links.indexOf(link);
				jpgLinks[chapterNum] = [];
				var chapterPath = mangaDirPath + "/" + chapterNum;
				var mkdir;
				try {
					mkdir = fs.mkdirAsync(chapterPath);
				} catch(e) {
					console.log(e);
					mkdir = fs.mkdirAsync(chapterPath);
				}
				mkdir.then(function() {
					return getLinks(link);
				})
				.then(function(jpgs) {
					jpgsLength += jpgs.length;
					var currentJpgPaths = [];
					for (var i = 0; i < jpgs.length; i++) {
						currentJpgPaths.push(chapterPath + "/" + jpgs[i].match(/\d+\.jpg$/)[0]);
					}
					currentJpgPaths.sort(sortJpgs);
					jpgs.sort(sortJpgs);
					for (i = 0; i < jpgs.length; i++) {
						jpgLinks[chapterNum].push({path: currentJpgPaths[i], link: jpgs[i]});
					}
					cb();
				});
			});
		})
		.then(function() {
			console.log("Downloading Manga");
			for (var i = 0; i < chapters.length; i++) {
				for (var j = 0; j < jpgLinks[i].length; j++) {
					mangaQueue.push(jpgLinks[i][j], function() {});
				}
			}
		});
	};
}

$(function() {
	var mangaName = $("input.manga-name");
	$("#current-save-location").text(fs.readFileSync("savelocation"));
	$("button.download").click(function() {
		(new Download()).getManga(convertName(mangaName.val()), function() {
			setTimeout(function() {$(".progress-bar").css("width", "0");}, 2000);
		});
	});
	$("button.setlocation").click(function() {
		var saveLocation = $("input.savelocation").val();
		fs.writeFileSync("./savelocation", saveLocation);
		$("#current-save-location").text(saveLocation);
		$("input.savelocation").val("");
	});
	mangaName.on("input", function() {
		var name = convertName(mangaName.val());
		requestAsync({uri: "http://mangapark.me/manga/" + name, headers: headers})
		.then(function(res) {
			var img = res[0].body.match(/<div\s*class="cover">\s*<img\s*src="(.+?)"/);
			console.log(img);
			if (img) {
				$("img").attr("src", img[1]);
			} else {
				$("img").attr("src", "no_image_available.png");
			}
		});
	});
});