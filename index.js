#!/usr/bin/env node

import chalk from "chalk";
import boxen from "boxen";
import figlet from "figlet";
import { SingleBar } from "cli-progress";
import readline from "readline";
import axios from "axios";
import Table from "cli-table";
import WebTorrent from "webtorrent";
import _ from "lodash";

const TorrentClient = new WebTorrent();
TorrentClient.on('error', function(err){
    log(err, 0);
});

var MovieToDownload = null;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('close', function (){
    if (MovieToDownload != null){
        if (MovieToDownload.downloadStatus != 2){
            console.log();
            log(chalk.black.bgYellowBright("We are sorry to see you go :( We'll resume from where we left off if you download again at the same location."));
        }
    }
    process.exit(0);
});

const prompt = (query) => new Promise((resolve) => rl.question(query, resolve));

const greetMsg = chalk.white.bold(
    figlet.textSync("Torential", {
        font: "Small",
        horizontalLayout: "fitted"
    })
);
const boxenOptions = {
    borderStyle: "round",
    borderColor: "yellow",
    backgroundColor: "#223",
    float: 'left',
    titleAlignment: 'center',
    title: chalk.bold.italic("It's raining movies today!!")
};
const greeting = boxen(greetMsg, boxenOptions);

const url = "https://yts.mx/api/v2/list_movies.json";
const Limit = 15;

var payload = {
    limit: Limit,
    page: "1",
    "quality": null,
    "minimum_rating": null,
    query_term: null,
    "genre": null,
    "sort_by": "year",
    "order_by": null,
    "with_rt_ratings": null
};

function formatter(options, params, payload){
    const completeSize = Math.round(params.progress * options.barsize);
    const incompleteSize = options.barsize - completeSize;
    const bar = options.barCompleteString.substr(0, completeSize) + options.barGlue + options.barIncompleteString.substr(0, incompleteSize);

    if (payload.percentage === "100%"){
        return '|' + chalk.green(bar)+ '| ' + chalk.greenBright(payload.percentage) + ' | ' + payload.downloaded + '/' + payload.size + ' | Speed: ' + payload.speed + ' | ETA: ' + payload.eta;
    }
    else{
        return '|' + chalk.cyan(bar)+ '| ' + payload.percentage + ' | ' + payload.downloaded + '/' + payload.size + ' | Speed: ' + payload.speed + ' | ETA: ' + payload.eta;
    }
}

class Movie{
    constructor(name, quality, size, hash){
        this.name = name;
        this.quality = quality;
        this.size = size;
        this.hash = hash;
        this.downloadStatus = 0; // 0: Not Started, 1: Downloaded metadata, torrent now ready to download, 2: Download complete 
    }
}

function readableSize(bytes, dp=2) {
    if (bytes != null && bytes !== 0){
        var i = Math.floor(Math.log(bytes)/Math.log(1024));
        return (bytes/Math.pow(1024, i)).toFixed(dp) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
    }
    else{
        return '0 B'
    }
}

function readableTime(seconds){
    seconds = Math.floor(seconds);
    if (seconds < 60) return (seconds+"s");
    else if (seconds < 3600) return ((seconds/60>>0) + "m "+ seconds%60 + "s");
    else{
        var minutes = seconds/60>>0;
        return ((minutes/60>>0) + "h "+ minutes%60 + "m");
    }
}

function log(text, level=2){
    switch(level){
        case 0:
            text = chalk.bgRed("ERROR") + chalk.red.bold(": "+text);
            break;
        case 1:
            text = chalk.bgYellow("WARNING") + chalk.yellow.bold(": "+text);
            break;
        default:
            text = text;
    }

    console.log(text);
}

async function MakeRequest(query, pageNo=1){
    payload.query_term = query;
    payload.page = pageNo.toString();
    var response = await axios.get(url, {
        params: payload,
        timeout: 5000
    });

    return response;
}

async function SearchAndGetMovie(){
    try{
        var table = new Table({
            head: ["#", "Name", "Run-time"],
            style: {compact: true, head: ["green"]},
        });

        var movieList = [];
        var movieCount = 0;
        var continueSearch = true;
        var searchText = "";
        var i = 0;
        do{
            if (continueSearch){
                i = 0;
                searchText = await prompt("> Enter Movie name: ");
            }

            if (!(searchText.length > 0)){
                continue;
            }

            var response = await MakeRequest(searchText, (i/Limit>>0)+1);
            var data = response["data"];

            if (data["status"] == "ok" && data["status_message"] == "Query was successful"){
                var moviesData = data["data"];
                movieCount = moviesData["movie_count"];

                if (i==0) { log("Found "+chalk.greenBright(movieCount)+" result(s)"); }

                if (moviesData["movies"] != null){
                    var warning = chalk.black.bgYellow("Note")+": Run-time=0s might not be accurate."
                    log("Showing "+chalk.greenBright.bold((i+1)+"-"+Math.min(i+Limit,movieCount))+" of "+chalk.greenBright(movieCount)+" result(s). "+warning);
                    
                    table = new Table({
                        head: ["#", "Name", "Run-time"],
                        style: {compact: true, head: ["green"]},
                    });

                    for (var movie of moviesData["movies"]){
                        var runTime = readableTime(movie["runtime"]*60);
                        table.push([++i, movie["title_long"], runTime]);
                    }

                    movieList = movieList.concat(moviesData["movies"]);
                    log(table.toString());

                    var input;
                    if (i < movieCount){
                        continueSearch = false;
                        input = await prompt("> Press Enter to continue... or enter # of Movie to download: ");
                    }
                    else if (i == movieCount){
                        continueSearch = false;
                        input = await prompt("> Enter # of Movie to download: ");
                    }

                    if (input > 0 && input <= i){
                        return movieList[parseInt(input)-1];
                    }
                }
                else{
                    continueSearch = true;
                }
            }
            else{
                log(response["status_message"], 0);
            }
        }while(i < movieCount || continueSearch);
    }
    catch (error){
        log(error, 0);
    }

    return null;
}

async function SelectTypeAndAddToMovieList(DesiredMovie){
    var name = DesiredMovie["title_long"];
    var torrents = DesiredMovie["torrents"];

    var table = new Table({
        head: ["#", "Quality", "Type", "Size"],
        style: {compact: true, head: ["cyan"]},
    });
    
    var i = 1;
    for (var torrent of torrents){
        table.push([i++, torrent["quality"], torrent["type"], torrent["size"]]);
    }
    
    log(table.toString());
    const type = await prompt("> Please select # of desired quality: ");
    if (type > 0 && type < i){
        var torrent = torrents[type-1]
        MovieToDownload = new Movie(name, torrent["quality"], torrent["size"], torrent["hash"]);
        return true;
    }
    else{
        return false;
    }
}

async function ExitApplication(){
    console.log();
    try{
        var dadJoke = await axios.get("https://icanhazdadjoke.com/", {
            headers: {
                Accept: "application/json",
                "User-Agent": "axios"
            },
            timeout: 5000
        });
        if (dadJoke["data"] != null){
            log("Thank you for using Torrential! I hope we continue to make you smile :)");
            log(boxen(chalk.cyanBright(dadJoke["data"]["joke"]), {
                borderStyle: "round",
                borderColor: "yellow",
                backgroundColor: "#123",
            }));
        }
    }
    catch(error){
        // log(error, 0);
    }

    rl.close();
}

// log inside every event listener and check if they are fired 
function DownloadMovie(){
    if (MovieToDownload == null){
        log("Nothing to Download.")
    }
    else{
        log("Downloading " + chalk.cyanBright(MovieToDownload.name+", "+MovieToDownload.quality));

        var magnetURI = "magnet:?xt=urn:btih:"+MovieToDownload.hash;
        var torrent = TorrentClient.add(magnetURI, {path: '.'});

        var progressBar = new SingleBar({
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            clearOnComplete: false,
            hideCursor: true,
            format: formatter
        });

        progressBar.start(100, 0, {
            percentage: "0%",
            downloaded: "0 B",
            size: MovieToDownload.size,
            speed: "- B/s",
            eta: "\u221E"
        });

        torrent.on('ready', function (){
            MovieToDownload.downloadStatus = 1;
        });

        torrent.on('download', _.throttle(function() {
            if (MovieToDownload.downloadStatus === 1){
                var progress = (torrent.progress*100).toFixed(1);
                var downloaded = readableSize(torrent.downloaded);
                var downloadSpeed = readableSize(torrent.downloadSpeed, 1)+"/s";
                // var uploadSpeed = readableSize(torrent.uploadSpeed)+"/s";
                var timeRemaining = readableTime(torrent.timeRemaining/1000);
                progressBar.update(Math.floor(progress), {
                    percentage: progress+"%",
                    downloaded: downloaded,
                    speed: downloadSpeed,
                    eta: timeRemaining
                });
            }
        }, 1000));

        torrent.on('done', function () {
            progressBar.update(100, {
                percentage: "100%",
                downloaded: MovieToDownload.size,
                speed: "-",
                eta: "0s"
            });
            progressBar.stop();
            MovieToDownload.downloadStatus = 2;
            torrent.destroy();
            ExitApplication();
        });

        torrent.on('error', function (err){
            log(err, 0);
        });
    }
}

const Torrential = async () => {
    console.log();
    console.log(greeting);

    var movieSelected = false;
    do{
        var movie = await SearchAndGetMovie();
        if (movie != null){
            if (await SelectTypeAndAddToMovieList(movie)){
                movieSelected = true;
                DownloadMovie();
            }
        }
    }while(!movieSelected);
};
  
Torrential();
