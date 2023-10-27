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

const playerPath = path.join(resources, 'player.html')

const cssHeader = `<style> ${fs.readFileSync(cssPath)} </style>`



if (fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true, force: true })
}

fs.mkdirSync(cachePath)

var videoCache = {}

var app = express()

app.use(bodyParser.urlencoded({ extended: false }))

app.use(express.static(staticPath))

app.listen(PORT, () => {
    console.log("Simpletube is now listening on port: " + PORT)
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
            const fileSize = videoCache[id].size
            // const fileSize = fs.statSync(vidpath).size + 1
            const parts = range.replace(/bytes=/, "").split("-")
            const start = parseInt(parts[0], 10)
            const end = parts[1]
                ? parseInt(parts[1], 10)
                : fileSize - 1

            if (start >= fs.statSync(vidpath).size + 1) {
                console.log("AAAAAAAAA")
                res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
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

            fs.createReadStream(vidpath, { start: start }).pipe(res)
        }

        if (id in videoCache) {
            ready(videoCache[id].path)
        } else {
            vidpath = path.join(__dirname, `cache/${id}.mp4`)

            var debounce = true

            var dp = 0
            ytdl(id, { filter: "videoandaudio", quality: "highest", format: 'mp4' })
                .on("progress", (chunk, ct, et) => {
                    if (debounce) {
                        debounce = false
                        videoCache[id] = {
                            "path": vidpath,
                            "size": et,
                            "downloaded": false,
                            "download%": 0
                        }
                        ready(vidpath, fs.readFileSync(vidpath))
                    }
                    var percent = Math.round(ct / et * 100)
                    if (percent > dp) {
                        dp = percent
                        videoCache[id]["download%"] = dp
                    }
                })
                .on("finish", () => {
                    videoCache[id]["downloaded"] = true
                })
                .pipe(fs.createWriteStream(vidpath))
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
    var id = req.query.q || req.query.v

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

    html = html.replace("{VIDEO_TITLE}", vidInfo.title)

    html = html.replace("{VIDEO_DESCRIPTION}", vidInfo.description || "No Description.")

    if (!(id in videoCache && videoCache[id]["downloaded"] == true)) {
        html = html.replace("{CACHE_WARNING}", `
        <p style="color: lightgray">Please note that this video has not been fully cached, and may have trouble loading!
        <br>{DOWNLOAD_PERCENT}% cached (as of page load).</p>
        `)
        if (id in videoCache && "download%" in videoCache[id]) {
            html = html.replace("{DOWNLOAD_PERCENT}", videoCache[id]["download%"])
        } else {
            html = html.replace("{DOWNLOAD_PERCENT}", "0")
        }
    } else {
        html = html.replace("{CACHE_WARNING}", "This video is fully cached!")
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