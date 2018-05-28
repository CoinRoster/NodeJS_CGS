/**
* Database settings used by the Gateway Services.
*/
var mysql      = require('mysql');
var connection = mysql.createPool({
  host     : 'localhost',
  user     : 'root',
  password : 'CRDroplet2017!'
});
 

/**
* Attempts to create a new pooled connection to the database using default settings.
*
* @param onConnect The callback function to invoke when the connection is successfully established.
* @param onFail The callback function to invoke when a connection can't be established.
*/
exports.connect = (onConnect, onFail) => {
	connection.getConnection(function(err, connectionInstance) {
	  if (err) {		
		onFail(connectionInstance);
		return;
	  }
	  onConnect(connectionInstance);
	});
}

/**
* Returns an indexed list of all databases available on the default connection.
* 
* @param callback The asynchronous callback function to be invoked when the list of databases is retrieved. The database list, an indexed array,
* will be included as the callback's parameter; null will be included if there was an error retrieving the database list.
*/
exports.getDatabases = (callback) => {
	connection.query("SELECT SCHEMA_NAME AS `Database` FROM INFORMATION_SCHEMA.SCHEMATA", function (err, results, fields) {
		if (err == null) {
			var dbVar = fields[0].name;
			var returnNames = new Array();
			for (var item in results) {
				var currentItem=results[item];
				returnNames.push(currentItem[dbVar]);
			}
			callback(returnNames);
		} else {
			return (null);
		}
	});
}

/**
* Returns an indexed list of all tables in a specific database.
* 
* @param dbName The name of the database for which to retrieve a list of available tables.
* @param callback The asynchronous callback function to be invoked when the list of tables is retrieved. The table list, an indexed array,
* will be included as the callback's parameter; null will be included if there was an error retrieving the table list.
*/
exports.getTables = (dbName, callback) => {
	connection.query("SELECT table_name FROM information_schema.tables where table_schema='"+dbName+"'", function(err, results, fields){
		if (err == null) {
			var tableVar = fields[0].name;			
			var returnNames = new Array();
			for (var item in results) {
				var currentItem=results[item];
				returnNames.push(currentItem[tableVar]);
			}
			callback(returnNames);
		} else {
			return (null);
		}
	});
}

/**
* Processes a supplied database query and returns the results to a generator.
* 
* @param dbName The name of the database for which to retrieve a list of available tables.
* @param generator The generator function to return query results to.
*/
exports.query = (queryStr, generator) => {
	connection.query(queryStr, function (error, rows, columns) {		
		var queryResultsObject = new Object();
		queryResultsObject.error = error;
		queryResultsObject.rows = rows;
		queryResultsObject.columns = columns;
		console.log(queryResultsObject);
		generator.next(queryResultsObject);
	});
}

/**
* Closes all pooled connections to the databse (use with caution).
*/
exports.closeAll = () => {
	connection.end(function(){
		console.log ("db.js: All pooled connections closed.");
	});
}