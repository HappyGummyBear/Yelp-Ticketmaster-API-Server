
const {tm_apikey, yelp_apikey} = require('./auth/credentials.json');
const http = require('http');
const https = require('https');
const port = 3002;
const server = http.createServer();
const fs = require('fs');
const querystring = require('querystring');

server.on("request", connection_handler);
function connection_handler(req, res){
    console.log(`New Request for ${req.url} from ${req.socket.remoteAddress}`);
    if(req.url == '/'){
        const main = fs.createReadStream('html/main.html');
        res.writeHead(200, {'Content-Type':'text/html'});
        main.pipe(res);
    }
    else if(req.url === "/images/banner.jpg"){
		const main = fs.createReadStream('./images/banner.jpg');
		res.writeHead(200, {'Content-Type':'image/jpeg'});
		main.pipe(res);
	}
    else if(req.url === "/favicon.ico"){
		const main = fs.createReadStream('images/favicon.ico');
		res.writeHead(200, {'Content-Type':'image/x-icon'});
		main.pipe(res);
	}
	else if(req.url.startsWith("/restaurant_imgs/")){
		const image_stream = fs.createReadStream(`.${req.url}`);
		image_stream.on('error', (err) => {
			res.writeHead(404, {'Content-Type': 'text/plain'});
			res.write("404 Not Found");
			res.end();
		})
		image_stream.on('ready', deliver_image);
		function deliver_image(){
			res.writeHead(200, {'Content-Type':'image/jpeg'})
			image_stream.pipe(res);
		}
	}
	else if(req.url.startsWith('search', 1)){
		const myURL = new URL(`https://example${req.url}`);
		user_artist = myURL.searchParams.get('artist');
		user_state = myURL.searchParams.get('state');
		if(user_artist === "" || user_state === ""){
			res.writeHead(400, {'Content-Type':"text/html"});
			res.write(`<h1>Error 400</h1><h2>Please fill out full form </h2><a href="/">*GO BACK*</a>`);
			res.end();
		}else{
			tm_param = {
				stateCode: user_state.toLowerCase(),
				keyword: user_artist.toLowerCase()
			}
			if(check_cache(tm_param)){
				let cache_data = require("./cache/old_searches.json");
				generate_cache(cache_data, tm_param, res);
			}else{
				const tm_endpoint = "https://app.ticketmaster.com/discovery/v2/events.json";
				let query_param = querystring.stringify(tm_param);
				let req_url = `${tm_endpoint}?${query_param}&apikey=${tm_apikey}`
				console.log(req_url);
				let tm_req = https.get(req_url, (search_res) => tm_search_result(search_res, tm_param, res));
				tm_req.on('error', (e) => {
					console.error(e);
					res.writeHead(422, {'Content-Type':"text/html"});
					res.write(`<h1>Error 400</h1><h2>Invalid inputs </h2><a href="/">*GO BACK*</a>`);
					res.end();
				});
			}
		}
	}
    else{
		res.writeHead(404, {'Content-Type': "text/html"});
		res.write("<h1>404 Not Found</h1>");
		res.end();
	}
}

server.on("listening", listening_handler);
function listening_handler(){
	console.log(`Now Listening on Port ${port}`);
}

function tm_search_result(search_res, tm_param, res){
	let body = "";
	search_res.on('data', chunk => body += chunk);
	search_res.on('end', () => tm_process_search(body, tm_param, res))
}

function tm_process_search(body, tm_param, res){
	let tm_res_json = JSON.parse(body);
	if(tm_res_json.page.totalElements == 0){
		res.writeHead(400, {'Content-Type':"text/html"});
		res.write(`<h1>No Events Found</h1><a href="/">GO BACK</a><div>*Check your inputs just in case</div>`);
		res.end();
	}
	else{
		let show = tm_res_json._embedded.events;
		let all_events = show.map(location => location._embedded.venues[0].name);
		all_events = all_events.filter( function(item, index, inputArray){
			return inputArray.indexOf(item) == index;
		});
		let webpage_data = {
			cache_inputs: tm_param,
			event_saved: show[0].name, 
			all_store_data: [],
			total: all_events.length*3,
			download_count : {
				image_array: [],
				total: 0
			}
		}
		webpage_data.download_count.total = all_events.length*3;
		all_events.forEach(event_name => {
			let event_restaurants = {
				venue_name: event_name,
				venue_restaurants: []
			}
			webpage_data.all_store_data.push(event_restaurants);
		});
		all_events.forEach(event_name => venue_restaurants(event_name, webpage_data, res));
	}
}

function venue_restaurants(event_location, webpage_data, res){
	const y_endpoint = "https://api.yelp.com/v3/businesses/search";

	let y_header = {
		'Authorization': `Bearer ${yelp_apikey}`
	}
	let y_params = {
		headers: y_header
	}
	let y_query_param = {
		term: "restaurant",
		location: event_location,
		limit: 3
	}

	let y_query_string = querystring.stringify(y_query_param);
	yelp_req = https.get(`${y_endpoint}?${y_query_string}`, y_params, (search_res) => process_yelp_request(search_res, event_location, webpage_data, res));
	yelp_req.on('error', (error) => function(){
		console.log(error);
		res.writeHead(404, {'Content-Type': "text/html"});
		res.write("<h1>404 Not Found</h1>");
		res.end();
	})
}

function process_yelp_request(search_res, event_location, webpage_data, res){
	let body = "";
	search_res.on('data', chunk => body += chunk);
	search_res.on('end', () => yelp_process_search(body, event_location, webpage_data, res))
}

function yelp_process_search(body, event_location, webpage_data, res){
	let yelp_res_json = JSON.parse(body);
	if(yelp_res_json.total == 0){
		res.writeHead(400, {'Content-Type':"text/html"});
		res.write(`<h1>No Restaurants Found</h1><a href="/">GO BACK</a><div>*Check your inputs just in case</div>`);
		res.end();
	}else{
		let each_business = yelp_res_json.businesses;
		webpage_data.all_store_data.forEach(venue => {
			if(venue.venue_name === event_location){
				each_business.forEach(store => {
					let store_info = {
						name_of_restaurant: store.name,
						phone: store.display_phone,
						distance: store.distance,
						score: store.rating,
						image_of_store: ""
					}
					venue.venue_restaurants.push(store_info);
				})
			}
		});
		each_business.forEach(store => download_images(store, event_location, webpage_data, res));
	}
}

function download_images(store, event_location, webpage_data, res){
	let url = store.image_url;
	let split_url = url.split("/");
	let file_name = split_url[split_url.length - 2];

	const img_path = `restaurant_imgs/${file_name}.jpg`;
	if(check_image_exist(img_path)){
		console.log("Image already downloaded");
		webpage_data.all_store_data.forEach(venue => {
			if(venue.venue_name === event_location){
				venue.venue_restaurants.forEach(restaurant => {
					if(restaurant.name_of_restaurant === store.name){
						restaurant.image_of_store = img_path;
					}
				})
			}
		});
		webpage_data.download_count.image_array.push(img_path);
		if(webpage_data.download_count.image_array.length === webpage_data.download_count.total){
			console.log("from image exist")
			cache_webpage(webpage_data);
			generate_webpage(webpage_data, res);
		}
	}
	else{
		const img_req = https.get(url);
		webpage_data.all_store_data.forEach(venue => {
			if(venue.venue_name === event_location){
				venue.venue_restaurants.forEach(restaurant => {
					if(restaurant.name_of_restaurant === store.name){
						restaurant.image_of_store = img_path;
					}
				})
			}
		});

		img_req.on('response', function recieved_image(image_stream){
			const stream_download = fs.createWriteStream(img_path, {encoding:null});
			image_stream.pipe(stream_download);
			stream_download.on('finish', function(){
				console.log("Downloaded Image", img_path);
				webpage_data.download_count.image_array.push(img_path);
				if(webpage_data.download_count.image_array.length >= webpage_data.download_count.total){
					console.log("from image download")
					cache_webpage(webpage_data);
					generate_webpage(webpage_data, res);
				}
			})
		});
	}
}

function generate_webpage(webpage_data, res){
	console.log("Generating Webpage");
	res.writeHead(200, {'Content-Type':"text/html"});
	let image_components = `<h1>Show: ${webpage_data.event_saved}</h1>`;
	webpage_data.all_store_data.forEach(venue => {
		image_components += `<h2>Restaurants for ${venue.venue_name}:<h2>`;
		venue.venue_restaurants.forEach(store => {
			image_components += `<h3>${store.name_of_restaurant}</h3><img src="${store.image_of_store}" 
			width="200" height="200" /><div style="display:inline-block;"><div><b>Distance from 
			${(venue.venue_name)}: ${Math.ceil(store.distance)} meters</b></div><div><b>Phone: 
			${store.phone}</b></div><div><b>Rating: ${store.score} stars</b></div></div>`;
		})
	})
	res.end(`${image_components}`);
}

function check_image_exist(image_path){
	if(fs.existsSync(image_path)){
		return true;
	}
	return false;

}

function cache_webpage(webpage_data){
	let search_exist = false;
	if(fs.existsSync("./cache/old_searches.json")){
		let cache = require('./cache/old_searches.json');
		cache.forEach(old_search => {
			if(old_search.cache_inputs.keyword.toLowerCase() === webpage_data.cache_inputs.keyword.toLowerCase() &&
				old_search.cache_inputs.stateCode.toLowerCase() === webpage_data.cache_inputs.stateCode.toLowerCase()){
					search_exist = true;
			}
		})
		if(search_exist){
			console.log("Current search already exist in cache. No need to save search.");
			return;
		}
		else{
			cache.push(webpage_data);
			console.log("Saved current search to cache");
			fs.writeFileSync("./cache/old_searches.json", JSON.stringify(cache));
		}
	}
	else{
		let cache_info = []
		cache_info.push(webpage_data);
		fs.writeFileSync("./cache/old_searches.json", JSON.stringify(cache_info));
		console.log("Created cache JSON");
		console.log("Saved search to cache");
	}
}

function check_cache(user_inputs){
	let search_exist = false;
	if(fs.existsSync('./cache/old_searches.json')){
		let cache = require('./cache/old_searches.json');
		cache.forEach(old_search => {
			if(old_search.cache_inputs.keyword.toLowerCase() === user_inputs.keyword.toLowerCase() &&
				old_search.cache_inputs.stateCode.toLowerCase() === user_inputs.stateCode.toLowerCase()){
					console.log("Saved cache matches current result");
					search_exist = true;
			}
		});
	}
	if(search_exist){
		return true;
	}
	else{
		return false;
	}
}

function generate_cache(cache_json, user_inputs, res){
	cache_json.forEach(old_search => {
		if(old_search.cache_inputs.keyword.toLowerCase() === user_inputs.keyword.toLowerCase() &&
			old_search.cache_inputs.stateCode.toLowerCase() === user_inputs.stateCode.toLowerCase()){
				console.log("Generating webpage from cache...")
				generate_webpage(old_search, res);
		}
	})
}

server.listen(port);