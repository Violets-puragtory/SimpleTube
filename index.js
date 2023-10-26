const express = require("express"),
    path = require("path"),
    fs = require("fs"),
    ytdl = require("ytdl-core"),
    bodyParser = require("body-parser")

const PORT = process.env.PORT || 8080

const staticPath = path.join(__dirname, 'static')
const resources = path.join(__dirname, 'resources')

const playerPath = path.join(resources, 'player.html')
const cssPath = path.join(resources, 'mainStyle.css')

const cssHeader = `<style> ${fs.readFileSync(cssPath)} </style>`

var app = express()

app.use(bodyParser.urlencoded({ extended: false }))

app.use(express.static(staticPath))

app.listen(PORT, () => {
    console.log("Simpletube is now listening on port: " + PORT)
})

app.get("/video", async (req, res) => {
    var id = req.query.q || req.query.v
    var range = req.headers.range
    console.log(req.headers.range)

    res.setHeader("X-Accel-Buffering", "no")

    if (!ytdl.validateID(id) && !ytdl.validateURL(id)) {
        res.setHeader("Content-Type", "text/html")
        res.write("Not a valid video id or url!")
        res.end()
        return
    }

    res.setHeader("Content-Type", "video/mp4")

    if (range) {
        const video = ytdl(id, { format: 'mp4' })
        video.on("info", (vidinfo, dlinfo) => {

            const fileSize = dlinfo.contentLength
            const parts = range.replace(/bytes=/, "").split("-")
            const start = parseInt(parts[0], 10)
            const end = parts[1]
                ? parseInt(parts[1], 10)
                : fileSize - 1
            
            if (start >= fileSize) {
                res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
                return
            }

            const chunksize = (end - start) + 1
            // const chunksize = 6585810944
            // console.log(start, end)

            res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`)
            res.setHeader("Accept-Ranges", 'bytes')
            res.setHeader("Content-Length", chunksize)

            video.pipe(res)
        })
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
    const id = req.query.q || req.query.v

    res.setHeader("Content-Type", "text/html")

    var vidInfo = (await ytdl.getBasicInfo(id)).videoDetails

    var html = fs.readFileSync(playerPath).toString()

    html = html.replace("{VIDEOID}", id)

    html = html.replace("{CSS_HEADER}", cssHeader)

    html = html.replace("{VIDEO_TITLE}", vidInfo.title)

    html = html.replace("{VIDEO_DESCRIPTION}", vidInfo.description || "No Description.")

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