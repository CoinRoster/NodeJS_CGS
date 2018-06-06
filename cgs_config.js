//Required modules:
const BigNumber = require('bignumber.js');

// *** Cryptocurrency Gateway Services Server Configuration ***

bcypher_network = "test3"; // one of "test3" or "main"
exports.balanceCheckInterval = 0; //the number of seconds required to elapse between successive external balance update API calls

//accounts used when withdrawals that exceed original deposit amounts
exports.withdrawalAccounts = [
	{
		"type":"btc",
		"account":"1HjSwXFqL4B2GWB6Umt34PX9R69xvPRzUz", 
		"private":"c3b2f4aabb1c9e7a2174f45466ca55dbf58885eec6b88f0a4cb68d7c18fe0bc9",
		"public":"0272f3649c2c94d565e649a5245d07b9196d01c6ce82bcf0e56b774464a061cac9",
		"wif":"L3n8AF1T3efSHM7eP3E3P5QZbhkhir39bDsJzUn2neBCSk1YoSUC"
	},
	{	
		"type":"tbtc",
		"account":"mjMSwGSkRa7qCRhXqS59wH1VmdByxjzNqx", 
		"private":"aa2e978974e794e76cc7c7b512821ac805a498e7bc1187c5097020096b89649d",
		"public":"039280efa28f56373e0919868d83577696ad2e4ffff48842ba02a62abf8f214b3f",
		"wif":"cTHWigzvW2F2aDVtTGMVb1WU3UvsF9g6QkbkFGhDYqj8tAx5bLJf"
	}
]; 

exports.coldStorageAddresses = [
	{
		'type': 'btc',
		'account': '1M6UzefHf3pTddP4JKGNVCQqMMpND55CXb'
	},
	{
		'type': 'tbtc',
		'account': 'morrjfo2FQqSSopV9YwHZYyJ95BaEdtUAf'
	}
];

//returns the next available withdrawal account from 'exports.withdrawalAccounts' based on the account type
exports.getNextWithdrawalAccount = (accountType) => {
	for (var count=0; count < exports.withdrawalAccounts.length; count++) {
		var currentAccount = exports.withdrawalAccounts[count]
		if (currentAccount.type == accountType) {
			return (currentAccount);
		}
	}
}

//returns the next available withdrawal account from 'exports.withdrawalAccounts' based on the account type
exports.getColdStorageAddress = (accountType) => {
	for (var count=0; count < exports.coldStorageAddresses.length; count++) {
		var currentAccount = exports.coldStorageAddresses[count]
		if (currentAccount.type == accountType) {
			return (currentAccount);
		}
	}
}

//external API access information such as tokens
exports.APIInfo={
	"blockcypher":
		{"token":"dea4a0d80c0a4567a758e2f6daa49050",
		//or "btc/main", "btc/test3"
		"network": bcypher_network,
		//default miner fee in Satoshis (must be a BigNumber!)
		"minerFee": new BigNumber("10"),
		"storageMinerFee": new BigNumber("1000")}
}; 


//JSON-RPC server options:
exports.rpc_options = {
  // Port that RPC server will listen on
  port: 8090,
  //Maximum number of batch JSON-RPC requests (more than this results in a JSONRPC_INTERNAL_ERROR error.
  max_batch_requests: 10,
  //Default response headers:
  headers: [
	{"Access-Control-Allow-Origin" : "*"},
	{"Content-Type" : "application/json"}
  ]
}

//Standards JSON-RPC error return code definitions:
exports.JSONRPC_PARSE_ERROR = -32700; // Parse error. Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text.
exports.JSONRPC_REQUEST_ERROR = -32600; // Invalid Request. The JSON sent is not a valid Request object.
exports.JSONRPC_METHOD_NOT_FOUND_ERROR = -32601; // Method not found. The method does not exist / is not available.
exports.JSONRPC_INVALID_PARAMS_ERROR = -32602; // Invalid params. Invalid method parameter(s).
exports.JSONRPC_INTERNAL_ERROR = -32603; // Internal error. Internal JSON-RPC error.

//Custom JSON-RPC error return code definitions (-32000 to -32099):
exports.JSONRPC_SQL_ERROR = -32001; // Database error. The database responded with an error.
exports.JSONRPC_SQL_NO_RESULTS = -32002; // Database error. The query returned no results.
exports.JSONRPC_EXTERNAL_API_ERROR = -32003; // An external API generated an error instead of an expected response.
exports.JSONRPC_NSF_ERROR = -32004; // Insufficient funds error. The account or address doesn't have sufficient funds to make this transaction.
exports.JSONRPC_CRF_ERROR = -32005; // Cash register funds error. The Cash Register has insufficient funds to make the transaction.
