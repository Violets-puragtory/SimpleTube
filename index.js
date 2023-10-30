const express = require("express"),
    path = require("path"),
    fs = require("fs"),
    ytdl = require("ytdl-core"),
    bodyParser = require("body-parser"),
    youtube = require("scrape-youtube")

const PORT = process.env.PORT || 8080

const staticPath = path.join(__dirname, 'static')

const cssPath = path.join(staticPath, 'mainStyle.css')

const resources = path.join(__dirname, 'resources')

const cachePath = path.join(__dirname, 'cache')
const searchCacheDur = (process.env.SEARCH_DUR || 24) * 3600000

const playerPath = path.join(resources, 'player.html')
const searchPath = path.join(resources, 'searchPage.html')

const cssHeader = `<style> ${fs.readFileSync(cssPath)} </style>`



if (fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true, force: true })
}

fs.mkdirSync(cachePath)


var videoCache = {}
var searchCache = {}

var app = express()

app.use(bodyParser.urlencoded({ extended: false }))

app.use(express.static(staticPath))

app.listen(PORT, () => {
    console.log("Simpletube is now listening on port: " + PORT)
})

async function cacher(id, ready) {
    vidpath = path.join(cachePath, `${id}.mp4`)

    var debounce = true

    var dp = 0
    var vidInfo = await ytdl.getBasicInfo(id)
    var video = ytdl(id, { filter: 'videoandaudio', quality: "highest", format: 'mp4' })
        .on("progress", (chunk, ct, et) => {
            
            if (debounce && (ct / et) > 0.015) {
                debounce = false
                videoCache[id] = {
                    "path": vidpath,
                    "size": et,
                    "downloaded": false,
                    "download%": 0,
                    "lastUsed": new Date().getTime(),
                    "duration": (vidInfo.videoDetails.lengthSeconds + 1) * 1000
                }

                ready(vidpath, fs.readFileSync(vidpath))
            }
            var percent = Math.round(ct / et * 100)
            if (!debounce && percent > dp && id in videoCache && "path" in videoCache[id]) {
                dp = percent
                videoCache[id]["download%"] = dp
            }
        })
        .on("finish", () => {
            if (id in videoCache) {
                videoCache[id]["downloaded"] = true
            }
        })
    return video
}

app.get("/search", async (req, res) => {
    var search = req.query.q || "How to search on SimpleTube"
    res.setHeader("Content-Type", "text/html")

    function searchReturn(results) {
        var videos = results.videos

        var html = fs.readFileSync(searchPath).toString()

        html = html.replace("{SEARCH}", search)

        var addedHTML = ""

        var channels = results.channels

        if (channels.length > 0) {

            addedHTML += "<h2><br>Channels:</h2>"

            for (let index = 0; index < channels.length; index++) {
                const channel = channels[index]
                addedHTML += `
                <div class="col-xxl-4 col-sm-6 resultContainer">
                    <div class="videoResult container-fluid row">
                        <div class="col-lg-5 col-md-6 thumbparent">
                            <a class="videoLink" href="/channel?q=${channel.id}">
                                <img class="pfp" src="${channel.thumbnail}">
                            </a>
                        </div>
                        <div class="col-lg-7 col-md-6">
                            <a class="videoLink" href="/channel?q=${channel.id}">
                                <p style="font-size: 1.25rem;">${channel.name || "No Title Found"}</p>
                                <p class="resultDescription">${channel.description || "No Description"}</p>
                            </a>
                        </div>
                    </div>
                </div>
                `
            }
        }

        addedHTML += "<h2><br>Videos:</h2>"

        for (let index = 0; index < videos.length; index++) {
            const result = videos[index];
            addedHTML += `
            <div class="col-xxl-4 col-sm-6 resultContainer">
                <div class="videoResult container-fluid row">
                    <div class="col-lg-6 thumbparent">
                        <a class="videoLink" href="/watch?v=${result.id}">
                            <img class="thumbnail" src="${result.thumbnail}">
                            <p style="display: block; text-align: left;">${result.durationString}</p>
                        </a>
                    </div>
                    <div class="col-lg-6">
                        <a class="videoLink" href="/watch?v=${result.id}">
                            <p style="font-size: 1.25rem;">${result.title || "No Title Found"}</p>
                            <p class="resultDescription">${result.description.substring(0, 75) + "..." || "No Description"}</p>
                        </a>
                    </div>
                    
                    <div style="display: inline-block; width: 100%;">
                        <a style="color: white; margin: 10px; display: inline-block;" href="${result.channel.link}">
                        <img src="${result.channel.thumbnail}" class="minipfp">
                        ${result.channel.name}
                        </a>
                    </div>
                </div>
            </div>
            `
        }

        res.send(html.replace("{RESULTS}", addedHTML))
    }

    var tA = Object.keys(searchCache)


    for (let index = 0; index < tA.length; index++) {
        itemName = tA[index]
        const item = searchCache[itemName];

        if (item[1] < Date.now()) {
            console.log("Deleted!")
            delete searchCache[search]
        }
    }

    if (search in searchCache) {
        searchReturn(searchCache[search][0])
        searchCache[search][1] = Date.now() + searchCacheDur
    } else {
        youtube.search(search, { type: "all" })
        .then((result)=> {
            searchReturn(result)
            searchCache[search] = [result, Date.now() + searchCacheDur]
        })
    }
})

app.get("/video", async (req, res) => {
    var id = req.query.q || req.query.v
    var range = req.headers.range

    res.setHeader("X-Accel-Buffering", "no")

    if (ytdl.validateURL(id)) {
        id = ytdl.getVideoID(id)
    }

    if (!ytdl.validateID(id)) {
        res.setHeader("Content-Type", "text/html")
        res.write("Not a valid video id or url!")
        res.end()
        return
    }

    res.setHeader("Content-Type", "video/mp4")

    if (range) {
        function ready(vidpath) {
            if (fs.existsSync(vidpath)) {
                const fileSize = videoCache[id].size
                const parts = range.replace(/bytes=/, "").split("-")
                const start = parseInt(parts[0], 10)
                const end = parts[1]
                    ? parseInt(parts[1], 10)
                    : fileSize - 1
    
                if (start >= fs.statSync(vidpath).size + 1) {
                    return
                }
    
                const chunksize = (end - start) + 1
    
                const head = {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': 'video/mp4',
                }
    
                res.writeHead(206, head)
    
                if (fs.existsSync(vidpath)) {
                    fs.createReadStream(vidpath, { start: start }).pipe(res)
                }
            }
        }

        console.log(videoCache)

        if (id in videoCache) {
            if ("path" in videoCache[id]) {
                ready(videoCache[id].path)
                videoCache[id].lastUsed = new Date().getTime()
            }
        } else {
            videoCache[id] = []
            var video = await cacher(id, ready)
            video.pipe(fs.createWriteStream(vidpath))
        }



    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
        }
        res.writeHead(200, head)
        fs.createReadStream(path).pipe(res)
    }
})

app.get("/watch", async (req, res) => {
    var id = req.query.q || req.query.v || "ubFq-wV3Eic"

    res.setHeader("Content-Type", "text/html")

    if (ytdl.validateURL(id)) {
        id = ytdl.getVideoID(id)
    }

    if (!ytdl.validateID(id)) {
        res.setHeader("Content-Type", "text/html")
        res.write("Not a valid video id or url!")
        res.end()
        return
    }

    var vidInfo = (await ytdl.getBasicInfo(id)).videoDetails

    var html = fs.readFileSync(playerPath).toString()

    html = html.replace("{VIDEOID}", id)

    html = html.replace("{CSS_HEADER}", cssHeader)

    for (let index = 0; index < 2; index++) {
        html = html.replace("{VIDEO_TITLE}", vidInfo.title)

    }

    html = html.replace("{VIDEO_DESCRIPTION}", vidInfo.description || "No Description.")

    if (!(id in videoCache && videoCache[id]["downloaded"] == true)) {
        html = html.replace("{CACHE_WARNING}", `
        <p style="color: lightgray">Please note that this video has not been fully cached, and may have trouble loading!
        <br>{DOWNLOAD_PERCENT}% cached as of page load. If content fails to load after a minute, reload the page!</p>
        `)
        if (id in videoCache && "download%" in videoCache[id]) {
            html = html.replace("{DOWNLOAD_PERCENT}", videoCache[id]["download%"])
        } else {
            html = html.replace("{DOWNLOAD_PERCENT}", "0")
        }
    } else {
        html = html.replace("{CACHE_WARNING}", "<p>This video is fully cached!</p>")
    }

    var finalThumb = vidInfo.thumbnails[vidInfo.thumbnails.length - 1].url
    html = html.replace("{VIDEO_THUMBNAIL}", finalThumb)

    res.send(html)
})

process.on('uncaughtException', (err, origin) => {
    fs.writeSync(
        process.stderr.fd,
        `Caught exception: ${err}\n` +
        `Exception origin: ${origin}`,
    );
});