/**
* A JSON-RPC 2.0 compliant Cryptocurrency Gateway Services  API
*/
//Required modules:
var db = require("./db.js"); //MySQL database
const querystring = require('querystring');
const filesystem = require('fs');
const http = require("http");
const https = require("https");
const request = require("request");
const crypto = require ("crypto");
const BigNumber = require('bignumber.js');
const bitcoin = require('bitcoinjs-lib');
const bip32 = require('bip32-utils');

const bcypher = require('blockcypher');
const bigi = require('bigi');
const buffer = require('buffer');

//Global server configuration:
var serverConfig = require("./cgs_config.js");


//*************************** RPC FUNCTIONS *************************************

/**
* newAccount [RPC/generator]: Generates and registers a new cryptocurrency account via an external service.
*
* @param postData The POST data included with the request.\
* 	required: @param type the type of cryptocurrency (currently only btc)
*			  @param craccount the coinroster username of the account
* @param requestObj The request object (https://nodejs.org/api/http.html#http_class_http_incomingmessage).
* @param requestObj The response object (https://nodejs.org/api/http.html#http_class_http_serverresponse).
* @param batchResponses An object containing expected responses for a batch. If null, this function is not being called as part of a batch. Usually the contents of this
* 			object are handled by the HTTP request processor and responder and so should not be updated.
*/
function* RPC_newAccount (postData, requestObj, responseObj, batchResponses) {
	var generator = yield;
	var requestData = JSON.parse(postData);
	var responseData = new Object();
	
	/* -----------------check required parameters, do API call-------------------------- */
	checkParameter(requestData, "type");
	checkParameter(requestData, "craccount");

	if (requestData.params.type != "btc") {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_INVALID_PARAMS_ERROR, "The cryptocurrency type \""+requestData.params.type+"\" is not supported for this operation.");
		return;
	}
	var serviceResponse=yield getNewAccountAddress(generator);
	if ((serviceResponse["error"] != null) && (serviceResponse["error"] != undefined)) {
		trace ("API error response on RPC_newAccount: "+serviceResponse.error);		
		trace ("   Request ID: "+requestData.id);
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_API_ERROR, "Experiencing one or more API failures when creating an account.");
		return;
	}
	if ((serviceResponse["address"] == null) || (serviceResponse["address"] == undefined)) {
		trace ("API error response on RPC_newAccount: "+serviceResponse);		
		trace ("   Request ID: "+requestData.id);
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_API_ERROR, "Experiencing one or more API failures when creating an account.");
		return;
	}
	responseData.account=serviceResponse.address;
	trace ("Created new account address: " + responseData.account);

	/* -----------------check if account exists already in cgs---------------------- */
	var cgsAccountSet = false;
	var cgsQueryResult;
	cgsQueryResult = yield db.query("SELECT * FROM `coinroster`.`cgs` WHERE `cr_account`=\""+requestData.params.craccount+"\"", generator);	

	if (cgsQueryResult.error != null) {
		trace ("Database error on rpc_newAccount: "+cgsQueryResult.error);
		trace ("   Request ID: "+requestData.id);
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_ERROR, "The database returned an error.");
		return;
	}
	if (cgsQueryResult.rows.length != 0) {
		cgsAccountSet = true;
	}

	/* -----------------check if account exists already in address------------------- */
	var addressAccountSet = false;
	var addressQueryResult;
	// account can only exist in address if it exists in cgs
	if(cgsAccountSet) {
		addressQueryResult = yield db.query("SELECT * FROM `coinroster`.`address` WHERE `cr_account`=\"" + requestData.params.craccount + "\" AND `btc_address`=\"" + cgsQueryResult.rows[0].btc_address + "\"", generator);	

		if (addressQueryResult.error != null) {
			trace ("Database error on rpc_newAccount: "+addressQueryResult.error);
			trace ("   Request ID: "+requestData.id);
			replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_ERROR, "The database returned an error.");
			return;
		}
		if (addressQueryResult.rows.length != 0) {
			addressAccountSet = true;
		}
	}
	
	/* ---------------if already in address table, flip active flag---------------- */
	if (addressAccountSet) {
		var updateQueryResult = yield db.query("UPDATE `coinroster`.`address` SET `active`=\"0\" WHERE `cr_account`=\"" + requestData.params["craccount"] +"\" AND `index`=\"" + addressQueryResult.rows[0].index + "\"", generator)
		if (updateQueryResult.error != null) {
			trace ("Database error on rpc_newAccount: " + updateQueryResult.error);
			trace ("   Request ID: " + requestData.id);
			replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_ERROR, "The database returned an error.");
			return;
		}
	}

	checkPaymentForward(requestData.params["craccount"]);
	/* ---------------package key information------------------------------------- */

	// key info object
	var newAccountInfo = Object();
	newAccountInfo.btc = new Object();
	newAccountInfo.btc.private = serviceResponse.private;
	newAccountInfo.btc.public = serviceResponse.public;
	newAccountInfo.btc.wif = serviceResponse.wif;

	/* -------------create cgs record if new, else update address in cgs------------- */
	var queryResult;

	if (!cgsAccountSet) {
		// update fields
		var insertFields = "(";
		if ((requestData.params["craccount"] != null) && (requestData.params["craccount"] != undefined) && (requestData.params["craccount"] != "")) {
			insertFields += "`cr_account`,";
		}
		insertFields += "`btc_address`,";
		insertFields += "`btc_c_balance`,";
		insertFields += "`btc_u_balance`,";
		insertFields += "`keys`";
		insertFields += ")";

		var insertValues = "("
		if ((requestData.params["craccount"] != null) && (requestData.params["craccount"] != undefined) && (requestData.params["craccount"] != "")) {
			insertValues += "\""+requestData.params.craccount+"\","; 
		}
		insertValues += "\""+responseData.account+"\","; 
		insertValues += "\"0\",";
		insertValues += "\"0\",";
		insertValues += "'"+JSON.stringify(newAccountInfo)+"'";
		insertValues += ")";
	
		// push updates
		queryResult = yield db.query("INSERT INTO `coinroster`.`cgs` " + insertFields+" VALUES " + insertValues, generator);	
		if (queryResult.error != null) {
			trace ("Database error on RPC_newAccount: "+queryResult.error);		
			trace ("   Request ID: "+requestData.id);
			replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_ERROR, "There was an error creating a new account address.");
			return;
		}
	} else {
		var insertFields = "(";
		insertFields += "`btc_address`,";
		insertFields += "`keys`";
		insertFields += ")";

		var insertValues = "(";
		insertValues += "\"" + responseData.account + "\",";
		insertValues += "'" + JSON.stringify(newAccountInfo) + "'";
		insertValues += ")";

		var queryResult = yield db.query("UPDATE `coinroster`.`cgs` SET `btc_address`=\"" + responseData.account + "\", `keys`='" + JSON.stringify(newAccountInfo) + "' WHERE `cr_account`=\"" + requestData.params["craccount"] + "\"", generator)
		if (queryResult.error != null) {
			trace ("Database error on rpc_newAccount: " + queryResult.error);
			trace ("   Request ID: " + requestData.id);
			replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_ERROR, "The database returned an error.");
			return;
		}
	}

	var updateAddress = yield updateAddressTable(requestData.params["craccount"] , responseData.account, newAccountInfo, generator);
	if (updateAddress === 'success') {
		replyResult(postData, requestObj, responseObj, batchResponses, responseData);
		return;
	} else {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_ERROR, "There was an error creating a new account address.");
		return;
	}
}


/**
* getBalance [RPC/generator]: Returns the available (posted), and confirmed balance for a specific account.
*
* @param postData The POST data included with the request:
						address (String, optional): The cryptocurrency address for which to return a balance. If 'craccount' is supplied then this parameter is ignored.
						craccount (String, optional): The CoinRoster account associated with the cryptocurrency. If this parameter is supplied then 'address' is ignored.
						type (String, required): The cryptocurrency type of the 'address' parameter (e.g. "btc").						
* @param requestObj The request object (https://nodejs.org/api/http.html#http_class_http_incomingmessage).
* @param requestObj The response object (https://nodejs.org/api/http.html#http_class_http_serverresponse).
* @param batchResponses An object containing expected responses for a batch. If null, this function is not being called as part of a batch. Usually the contents of this
* 			object are handled by the HTTP request processor and responder and so should not be updated.
*/
function* RPC_getBalance(postData, requestObj, responseObj, batchResponses) {

	var generator = yield;
	var requestData = JSON.parse(postData);
	var responseData = new Object();
	
	/* Check parameters, query details from db */
	// check request data for required params
	checkParameter(requestData, "type");
	if (requestData.params.type != "btc") {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_INVALID_PARAMS_ERROR, "The cryptocurrency type \""+requestData.params.type+"\" is not supported for this operation.");
		return;
	}
	var accountSet = false;
	if ((requestData.params["craccount"] != undefined) && (requestData.params["craccount"] != null) && (requestData.params["craccount"] != "")) {
		accountSet = true;
		var queryResult = yield db.query("SELECT * FROM `coinroster`.`cgs` WHERE `cr_account`=\""+requestData.params.craccount+"\"", generator);	
	} else {
		if ((requestData.params["address"] != undefined) && (requestData.params["address"] != null) && (requestData.params["address"] != "")) {
			queryResult = yield db.query("SELECT * FROM `coinroster`.`cgs` WHERE `btc_address`=\""+requestData.params.address+"\"", generator);	
		} else {
			replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_INVALID_PARAMS_ERROR, "An address or account must be provided in the request.");
			return;
		}
	}
	if (queryResult.error != null) {
		trace ("Database error on rpc_getAccountBalance: "+queryResult.error);
		trace ("   Request ID: "+requestData.id);
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_ERROR, "The database returned an error.");
		return;
	}
	if (queryResult.rows.length == 0) {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_NO_RESULTS, "No matching account or address.");
		return;
	}
	if ((queryResult.rows[0].last_live_balance_check != null) && (queryResult.rows[0].last_live_balance_check != "NULL")) {
		var lastCheckDateObj = new Date(queryResult.rows[0].last_live_balance_check);	
	} else {
		lastCheckDateObj = new Date(1970,1,1);	
	}

	trace ("Performing live blockchain balance check...");
	var accountInfo=yield checkAccountBalance(generator, queryResult.rows[0].btc_address);
	accountInfo = checkBalanceObj(accountInfo); //check for duplicate transactions
	// ----------------------------------------------------------------------------
	try {
		var btc_balance_confirmed = new BigNumber(String(accountInfo.balance));
		btc_balance_confirmed = btc_balance_confirmed.times(new BigNumber(0.00000001)); //convert from Satoshis to Bitcoin
		var btc_balance_unconfirmed = new BigNumber(String(accountInfo.unconfirmed_balance));
		btc_balance_unconfirmed = btc_balance_unconfirmed.times(new BigNumber(0.00000001));
		var dbUpdates = "`btc_c_balance`=\""+btc_balance_confirmed.toString()+"\",";
		dbUpdates += "`btc_u_balance`=\""+btc_balance_unconfirmed.toString()+"\",";	
		dbUpdates += "`last_live_balance_check`=NOW()";	
		if (accountSet) {
			accountUpdateResult = yield db.query("UPDATE `coinroster`.`cgs` SET "+dbUpdates+" WHERE `cr_account`=\""+requestData.params.craccount+"\" AND `index`="+queryResult.rows[0].index+" LIMIT 1", generator);
		} else {
			accountUpdateResult = yield db.query("UPDATE `coinroster`.`cgs` SET "+dbUpdates+" WHERE `btc_address`=\""+requestData.params.address+"\" AND `index`="+queryResult.rows[0].index+" LIMIT 1", generator);
		}
		if (accountSet) {
			responseData.craccount = requestData.params.craccount;
		} else {
			responseData.address = requestData.params.address;
		}
		responseData.type = requestData.params.type;
		responseData.balance = new Object();
		
		responseData.balance.bitcoin_cnf = new BigNumber(String(accountInfo.balance)); //accountInfo.balance is in Satoshis, as returned by external API
		responseData.balance.bitcoin_cnf = responseData.balance.bitcoin_cnf.times(new BigNumber(0.00000001));
		responseData.balance.bitcoin_unc = new BigNumber(String(accountInfo.unconfirmed_balance));
		responseData.balance.bitcoin_unc = responseData.balance.bitcoin_unc.times(new BigNumber(0.00000001));
		responseData.balance.satoshi_cnf = String(accountInfo.balance);
		responseData.balance.satoshi_unc = String(accountInfo.unconfirmed_balance);
		responseData.balance.bitcoin = new BigNumber(String(accountInfo.balance));
		responseData.balance.bitcoin = responseData.balance.bitcoin.times(new BigNumber(0.00000001));
		responseData.balance.bitcoin_cnf = responseData.balance.bitcoin_cnf.toString();
		responseData.balance.bitcoin_unc = responseData.balance.bitcoin_unc.toString();
		responseData.balance.satoshi_cnf = responseData.balance.satoshi_cnf.toString();
		responseData.balance.satoshi_unc = responseData.balance.satoshi_unc.toString();
		responseData.balance.bitcoin = responseData.balance.bitcoin.toString();		
		replyResult(postData, requestObj, responseObj, batchResponses, responseData);
	} catch (err) {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_EXTERNAL_API_ERROR, "Balance for address or account could not be determined.");
		return;
	}
}

/**
* sendTransaction [RPC/generator]: Cashes out the specified Bitcoin balance by invoking an external service.
*
* @param postData The POST data included with the request. JSON object must contain:
				"fromAddress" (String, optional): The sending account/address. If 'rcaccount' is supplied then this parameter is ignored.
				"craccount" (String, optional): The CoinRoster account of the sender. If omitted, 'fromAddress' is used instead and must be supplied.
                "toAddress" (String, required): The receiving account/address.
                "type" (String, required): The type of cryptocurrency being sent (e.g. "btc").
                "amount" (Object, required): An object containing the amount of cryptocurrency to send in the transaction. The format of this object
                                May vary depending on the cryptocurrency "type". For "btc" type transactions, this object must contain:
                                                "satoshi" (String): The amount of Bitcoin to send, in satoshi, in the transaction.
                "keys" (Object, optional): The private/public keys to use to send the transaction with. The format of this object may differ depending on the "type"
                                Of cryptocurrency being sent. If omitted, the method will attempt to use the database key values for the account/address.
								When sending a "btc" type transaction, this object must contain:
                                                "private" (String): The private key of the sending address in hexadecimal notation.
                                                "public" (String): The public key of the sending address in hexadecimal notation.
                                                "wif" (String): The Wallet Import Format data string containing both the private and public keys
                                                                                of the sending address.
 
					
* @param requestObj The request object (https://nodejs.org/api/http.html#http_class_http_incomingmessage).
* @param requestObj The response object (https://nodejs.org/api/http.html#http_class_http_serverresponse).
* @param batchResponses An object containing expected responses for a batch. If null, this function is not being called as part of a batch. Usually the contents of this
* 			object are handled by the HTTP request processor and responder and so should not be updated.
*/
function* RPC_sendTransaction (postData, requestObj, responseObj, batchResponses) {
	
	var generator = yield;
	var requestData = JSON.parse(postData);
	
	// Check input
	checkParameter(requestData, "toAddress");	
	checkParameter(requestData, "type");
	checkParameter(requestData, "amount");
	checkParameter(requestData, "user_balance");
	if (requestData.params.type != "btc") {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_INVALID_PARAMS_ERROR, "The cryptocurrency type \""+requestData.params.type+"\" is not supported for this operation.");
		return;
	}
	var returnData = new Object();
	var senderAddress = null;
	if ((requestData.params.amount["satoshi"] != null) && (requestData.params.amount["satoshi"] != undefined) && (requestData.params.amount["satoshi"] != "") && (isNaN(Number(requestData.params.amount["satoshi"])) == false)) {
		var withdrawalSatoshisReq = new BigNumber(requestData.params.amount.satoshi);
	} else {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_INVALID_PARAMS_ERROR, "Invalid satoshi withdrawal amount.");
		return;
	}
	if ((requestData.params["craccount"] != null) && (requestData.params["craccount"] != undefined) && (requestData.params["craccount"] != "")) {
		var accountSet = true;
	} else {
		if ((requestData.params["fromAddress"] == null) || (requestData.params["fromAddress"] == undefined) || (requestData.params["fromAddress"] == "")) {
			replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_INVALID_PARAMS_ERROR, "An address or account must be provided in the request.");
			return;
		}
		accountSet = false;
	}

	// DB query, pretty much redundant ======================================================
	if (accountSet) {
		var queryResult = yield db.query("SELECT * FROM `coinroster`.`cgs` WHERE `cr_account`=\""+requestData.params.craccount+"\" LIMIT 1", generator);
	} else {
		queryResult = yield db.query("SELECT * FROM `coinroster`.`cgs` WHERE `btc_address`=\""+requestData.params.fromAddress+"\" LIMIT 1", generator);
	}
	if (queryResult.error != null) {
		trace ("Database error on RPC_sendTransaction: "+queryResult.error);
		trace ("   Request ID: "+requestData.id);
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_ERROR, "There was a database error when processing the request.");
		return;
	}
	if (queryResult.rows.length == 0) {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_NO_RESULTS, "No matching account or address.");
		return;
	}
	//=======================================================================================


	//---- UPDATE MINER FEE (redundancy)----
	var currentAPI = serverConfig.APIInfo.blockcypher;
	if ((requestData.params["custom_fee"] == null) || (requestData.params["custom_fee"] == undefined) || (requestData.params["custom_fee"] == "")) {
		trace ("Custom miner fee not provided");

		var feeQueryResult = yield db.query("SELECT VALUE FROM `coinroster`.`control` WHERE NAME='miner_fee'", generator);	
		
		if (queryResult.error != null) {
			trace ("   Could not retrieve miner fee from database! Using default: "+currentAPI.minerFee.toString());
			trace (JSON.stringify(feeQueryResult.error));
		}
		if (feeQueryResult.rows.length == 0) {
			trace ("   Miner fee could not be found in database! Using default: "+currentAPI.minerFee.toString());
		} else {
			currentAPI.minerFee = new BigNumber(String(feeQueryResult.rows[0].VALUE));
			trace ("   Miner fee retrieved from database: "+currentAPI.minerFee.toString());
		}
	} else {
		trace ("Custom miner fee provided " + requestData.params["custom_fee"] + " " + typeof(requestData.params["custom_fee"]));
		currentAPI.minerFee = new BigNumber(requestData.params["custom_fee"]);
	}

	//---- SET UP MAIN ACCOUNT VARIABLES ----
	var UserBtcBalance = new BigNumber(requestData.params["user_balance"]);
	var satoshiPerBTC = new BigNumber("100000000");
	var satoshiBalanceConf = UserBtcBalance.times(satoshiPerBTC);
	trace ("satoshiBalanceConf="+satoshiBalanceConf);
	trace ("serverConfig.APIInfo.blockcypher.minerFee.dividedBy(satoshiPerBTC)="+serverConfig.APIInfo.blockcypher.minerFee.dividedBy(satoshiPerBTC));
	var BTCBalanceConf_fee = UserBtcBalance.minus(serverConfig.APIInfo.blockcypher.minerFee);
	var satoshiBalanceConf_fee = satoshiBalanceConf.minus(serverConfig.APIInfo.blockcypher.minerFee);
	trace ("satoshiBalanceConf_fee="+satoshiBalanceConf_fee.toString());

	if (satoshiBalanceConf_fee.lessThanOrEqualTo(0)) {
		trace ("      Available balance minus miner fee is <= 0.");
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_NSF_ERROR, "Your available balance, minus the miner fee ("+serverConfig.APIInfo.blockcypher.minerFee.toString()+" satoshis) is insufficient to make a withdrawal.");
		return;	
	}
	trace ("   Enough confirmations and sufficient balance to withdraw.");
	if ((requestData.params["keys"] != null) && (requestData.params["keys"] != undefined) && (requestData.params["keys"] != "") && (typeof(keys) == "object")) {
		var keyData = requestData.params.keys[requestData.params.type];
	} else {
		keyData = JSON.parse(queryResult.rows[0].keys)[requestData.params.type];	
	}
	trace ("withdrawalSatoshisReq="+withdrawalSatoshisReq.toString());

	// cash register payment ---------------------------------------------------------------

	if (serverConfig.APIInfo.blockcypher.network == "test3") {
		var cashRegister = serverConfig.getNextWithdrawalAccount("tbtc");
	} else {
		cashRegister = serverConfig.getNextWithdrawalAccount("btc");
	}	
	var cashRegisterInfo = yield checkAccountBalance(generator, cashRegister.account);
	cashRegisterInfo = checkBalanceObj(cashRegisterInfo); //check for duplicate transactions
	
	if (withdrawalSatoshisReq.greaterThan(cashRegisterInfo.final_balance)) {
		// cash register does not have enough to cover withdrawal request
		trace("Cash register does not have enough balance");
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_CRF_ERROR, "Insufficient Cash Register Funds");
		return;
	} else {
		trace("Processing withdrawal from cash register");
		var wif = cashRegister.wif;
		var txSkeleton = yield getTxSkeleton (cashRegister.account, requestData.params.toAddress, withdrawalSatoshisReq, generator);
	}
	
	if ((txSkeleton["error"] != null) && (txSkeleton["error"] != undefined) && (txSkeleton["error"] != "")) {
		trace ("      Error creating transaction skeleton: \n"+txSkeleton.error);
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_EXTERNAL_API_ERROR, "There was a problem creating the transaction.", txSkeleton);
		return;
	}
	try {
		var signedTx = signTxSkeleton (txSkeleton, wif);
	} catch (err) {
		trace ("      Error signing transaction skeleton: \n"+err+"\n");
		trace (JSON.stringify(txSkeleton));
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_EXTERNAL_API_ERROR, "There was a problem signing the transaction.", txSkeleton);
		return;
	}
	var sentTx = yield sendTransaction(signedTx, generator);
	trace ("      Posted transaction: "+JSON.stringify(sentTx));
	returnData = sentTx.tx;
	returnData.cashRegisterBalance = cashRegisterInfo.final_balance;
	if ((sentTx["tx"] != undefined) && (sentTx["tx"] != null)) {
		if ((sentTx.tx["hash"] != null) && (sentTx.tx["hash"] != undefined) && (sentTx.tx["hash"] != "") && (sentTx.tx["hash"] != "NULL")) {
			trace("Withdrawal Tx hash: " + sentTx.tx["hash"]);
		}
	} else {
		trace ("      Error sending transaction: \n"+JSON.stringify(sentTx));
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_EXTERNAL_API_ERROR, "There was a problem sending the transaction.", sentTx);
		return;
	}
	replyResult(postData, requestObj, responseObj, batchResponses, returnData);
}

/**
* Pushes any balance in an address to the cold storage address
* 
* @param postData The POST data included with the request:
					address (String, optional): The cryptocurrency address for which to return a balance. If 'craccount' is supplied then this parameter is ignored.
					craccount (String, optional): The CoinRoster account associated with the cryptocurrency. If this parameter is supplied then 'address' is ignored.
					type (String, required): The cryptocurrency type of the 'address' parameter (e.g. "btc").						
* @param requestObj The request object (https://nodejs.org/api/http.html#http_class_http_incomingmessage).
* @param responseObj The response object (https://nodejs.org/api/http.html#http_class_http_serverresponse).
* @param batchResponses An object containing expected responses for a batch. If null, this function is not being called as part of a batch. Usually the contents of this
* 			object are handled by the HTTP request processor and responder and so should not be updated.
*/
function* RPC_pushToColdStorage(postData, requestObj, responseObj, batchResponses) {

	var generator = yield;
	var requestData = JSON.parse(postData);
	
	
	// check request data for required params and initialize bcypher object
	checkParameter(requestData, "address");
	checkParameter(requestData, "type");
	
	var bcapi = new bcypher(requestData.params["type"], serverConfig.APIInfo.blockcypher.network, serverConfig.APIInfo.blockcypher.token);

	if ((requestData.params["address"] != undefined) && (requestData.params["address"] != null) && (requestData.params["address"] != "")) {
		var queryResult = yield db.query("SELECT * FROM `coinroster`.`cgs` WHERE `btc_address`=\"" + requestData.params["address"] + "\"", generator);	
	} else {
		// redundancy
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_INVALID_PARAMS_ERROR, "An address must be provided in the request.");
		return;
	}

	if (queryResult.error != null) {
		trace ("Database error on rpc_pushToColdStorage: " + queryResult.error);
		trace ("   Request ID: "+requestData.id);
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_ERROR, "The database returned an error.");
		return;
	}

	if (queryResult.rows.length == 0) {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_SQL_NO_RESULTS, "No matching account or address.");
		return;
	}


	// get balance of sender address
	bcapi.getAddrBal(requestData.params["address"], {}, function(err, data) {

		trace('err: ' + err);
		trace(data);
		trace('The wallet contains:' +  data.final_balance + ' satoshi (' + data.final_balance * 0.00000001 + 'BTC)');
		var responseData = new Object();
		if(err) {
			trace("balance check error: " + err);
			replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_EXTERNAL_API_ERROR, "Could not complete external API call");
			return;
		}

		// data = checkBalanceObj(data);
		trace('live balance check');
		//if(data.final_balance > 0 && data.balance > 0) {
		if (data.balance > 0) {
			trace("positive balance in deposit account, pushing to cold storage: " + requestData.params["address"])
			
			//var responseData = new Object();
			var amount = new BigNumber(data.final_balance);
			amount = amount.minus(serverConfig.APIInfo.blockcypher.storageMinerFee);
			trace('miner fee: ' + serverConfig.APIInfo.blockcypher.storageMinerFee);

			if (serverConfig.APIInfo.blockcypher.network == "test3") {
				var coldStorageAddress = serverConfig.getColdStorageAddress("tbtc").account;
			} else {
				coldStorageAddress = serverConfig.getColdStorageAddress("btc").account;
			}	
			var newtx = {
				inputs: [{addresses: [requestData["params"].address]}],
				outputs: [{addresses: [coldStorageAddress], value: Number(amount)}],
				fees: Number(serverConfig.APIInfo.blockcypher.storageMinerFee)	
			};

			trace("creating tx: " + JSON.stringify(newtx));

			var keyData = JSON.parse(queryResult.rows[0].keys)[requestData.params.type];
			var keys = new bitcoin.ECPair(bigi.fromHex(keyData.private));
			trace(JSON.stringify(keyData));
			bcapi.newTX(newtx, function(err,data) {
				console.log(data);
				if (err) {
					trace("Error creating transaction skeleton: \n"+ JSON.stringify(err));
					replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_EXTERNAL_API_ERROR, "There was a problem creating the transaction.", err);
					return;
				}
				if (((data["errors"] != null) && (data["errors"] != undefined) && (data["errors"] != ""))
					  || ((data["error"] != null) && (data["error"] != undefined) && (data["error"] != ""))) {
					trace ("      Error creating transaction skeleton: \n"+ JSON.stringify(data.errors));
					trace (JSON.stringify(data));
					replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_EXTERNAL_API_ERROR, "There was a problem creating the transaction.", data["errors"].error);
					return;
				}
				// sign transaction and add public key
				data.pubkeys = [];
				data.signatures = data.tosign.map(function(tosign) {
					data.pubkeys.push(keys.getPublicKeyBuffer().toString("hex"));
					console.log(data);
					return keys.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex");
				});
				
				// finally, post the transaction on the network
				bcapi.sendTX(data, (err, data) => {
					if (err !== null || ((data["errors"] != null) && (data["errors"] != undefined) && (data["errors"] != ""))) {
						var error = data["errors"].error;
						trace("error posting the transaction: " + JSON.stringify(data));
						replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_EXTERNAL_API_ERROR, "There was a problem creating the transaction.", JSON.stringify(data));
						return;
					} else {
						trace("the deposited amount was successfully forwarded to cold storage:");
						trace(JSON.stringify(data));
						
						responseData.tx = data.tx; 			
						replyResult(postData, requestObj, responseObj, batchResponses, responseData);
						return;
					}
				});
			});
		}
		responseData.result = "no balance";
		replyResult(postData, requestObj, responseObj, batchResponses, responseData);
	});
}

//*************************** UTILITY FUNCTIONS *************************************

/** 
 * 
 * 
 */
function checkPaymentForward (craccount) {
	db.query("SELECT * FROM `coinroster`.`address` WHERE `cr_account`=\"" + craccount + "\" AND `forwarded_to_storage`=\"0\"", (data) =>{
		//trace(JSON.stringify(data.rows[0]));
		for(i = 0; i < data.rows.length; i++) {
			console.log(Number(i + 1) + ": " + data.rows[i].btc_address + '\n');
		}
	});
}

/**
 * Updates address table with new row containing address information
 * 
 * @param craccount the coinroster username
 * @param btc_address the new btc address to be added
 * @param generator callback/generator to return sucess
 */
function updateAddressTable (craccount, btc_address, keys, generator) {

	/* set up database updates to CGS table */

	// update fields
	var insertFields = "(";
	insertFields += "`btc_address`,";
	insertFields += "`cr_account`,";
	insertFields += "`keys`";
	insertFields += ")";

	// update values
	var insertValues = "(";
	insertValues += "\""+ btc_address +"\","; 
	insertValues += "\""+ craccount +"\",";
	insertValues += "\'"+ JSON.stringify(keys) +"\'";
	insertValues += ")";

	// push updates
	var queryResult = db.query("INSERT INTO `coinroster`.`address` " + insertFields+" VALUES " + insertValues, (data) => {
		if (data.error != null) {
			generator.next(data.error);
		} else {
			generator.next("success");
		}
	});	
}

/**
* Checks a Bitcoin account balance via an external API request.
*
* @param generator The generator function to return the API result to.
* @param account The Bitcoin account to check a balance for.
*/
function checkAccountBalance(generator, account, type) {
	var netwk = type || 'btc';
	request({
		url: "https://api.blockcypher.com/v1/"+netwk+'/'+serverConfig.APIInfo.blockcypher.network+"/addrs/"+account+"/full",
		method: "GET",
		json: true		
	}, function (err, response, body){ 
		if(generator){
			generator.next(body);	
		} else {
			return body;
		}
	});
}

/**
* Invokes an external service in order to generate a new Bitcoin account address.
* 
* @param generator The generator function invoking this method and expecting the resulting data.
*/
function getNewAccountAddress(generator, type) {
	var netwk = type || "btc";			
	request({			  
		url: "https://api.blockcypher.com/v1/"+netwk+'/'+serverConfig.APIInfo.blockcypher.network+"/addrs",
		method: "POST",
		json: true    
	}, function (error, response, body){   
		/*
		body.address: newly-generated address
		body.private: private key
		body.public: public key
		body.wif: Wallet Import Format account data (https://en.bitcoin.it/wiki/Wallet_import_format)
		*/		
		generator.next(body);
	});
} 

/**
* Checks and updates the Bitcoin balance for an address from a BlockCypher balance API response (which sometimes returns duplicate transactions and calculates an incorrect balance amount).
*
* @param bcBalanceObj A native object containing the account balance response from BlockCypher's API.
*
* @return A copy of the 'bcBalanceObj' object with any duplicate transactions removed and balances updated, if necessary. Null is returned if there was a problem parsing the parameters.
*/
function checkBalanceObj(bcBalanceObj) {
	try {
		var returnObj = new Object();
		var targetAddress = bcBalanceObj.address;
		for (var item in bcBalanceObj) {
			if (item != "txs") {
				returnObj[item] = bcBalanceObj[item];
			}
		}
		if ((bcBalanceObj["txs"] != undefined) && (bcBalanceObj["txs"] != null) && (bcBalanceObj["txs"] != "")) {
			returnObj.txs = new Array();
		}
		for (var count=0; count<bcBalanceObj.txs.length; count++) {
			var currentTx = bcBalanceObj.txs[count];
			if (!transactionExists(returnObj.txs, currentTx.hash)) {
				returnObj.txs.push (currentTx);
			} else {
				trace("   Discovered duplicate transaction: "+currentTx.hash);
				for (var count2=0; count2<currentTx.outputs.length; count2++) {
					var currentOutput = currentTx.outputs[count2];
					for (var count3 = 0; count3 < currentOutput.addresses.length; count3++) {
						if (currentOutput.addresses[count3] == targetAddress) {
							if (currentTx.confirmations == 0) {
								trace ("      Reducing unconfirmed balance by: "+currentOutput.value);
								returnObj.unconfirmed_balance -= currentOutput.value;
							} else {
								trace ("      Reducing confirmed balance by: "+currentOutput.value);
								returnObj.balance -= currentOutput.value;
							}
						}
					}
				}
			}
		}
	} catch (err) {
		return (null);
	}
	return (returnObj);
}

/**
* Checks if a transaction exists within an array of transactions.
*
* @param txArray The transaction array to check through.
* @param txhash The transaction hash to check for.
*
* @return True if the specified transaction exists in the array, false otherwise.
*/
function transactionExists (txArray, txhash) {
	try {
		for (var count=0; count<txArray.length; count++) {
			var currentTx = txArray[count];
			if (currentTx.hash == txhash) {
				return (true);
			}
		}
	} catch (err) {
	}
	return (false);
}

/**
* Receives a list of all inputs for an account.
*
* @param generator The generator function to invoke when thhe asynchronous operations has completed.
* @param btc_account The Bitcoin account address for which to retrieve inputs.
*/
function getIncomingTransactionsForAccount(btc_account, generator) {
	request({
		url: "https://api.blockcypher.com/v1/"+serverConfig.APIInfo.blockcypher.network+"/addrs/"+btc_account+"/full?limit=50&txlimit=10000",
		method: "GET",
		json: true    
	}, function (error, response, body){
		var transactions = null;
		if (error == null) {
			for (var count = 0; count < body.txs.length; count++) {
				var currentTransaction = body.txs[count];
				var inputAddresses = new Array();
				//parse the data out of the API response
				for (var count2 = 0; count2 < currentTransaction.inputs.length; count2++) {
					var currentInput = currentTransaction.inputs[count2];
					for (var count3 = 0; count3 < currentInput.addresses.length; count3++) {
						inputAddresses.push(currentInput.addresses[count3]);
					}
				}
				var txOuts = currentTransaction.outputs;
				for (count2 = 0; count2 < txOuts.length; count2++){
					var currentTxOut = txOuts[count2];
					var txOutAddresses = currentTxOut.addresses;
					for (count3 = 0; count3 < txOutAddresses.length; count3++) {
						var currentTxOutAddress = txOutAddresses[count3];
						if (currentTxOutAddress == btc_account) {
							if (transactions == null) {
								transactions = new Array();
							}
							var accountTransactionObj = new Object();
							accountTransactionObj.addresses = txOutAddresses;
							accountTransactionObj.senderAddresses = inputAddresses;
							accountTransactionObj.receivedAddress = btc_account;
							accountTransactionObj.txhash = currentTransaction.hash;
							accountTransactionObj.txIndex = count3;
							accountTransactionObj.total_tx_satoshis = String(currentTxOut.value);
							transactions.push(accountTransactionObj);
						}
					}
				}
			}
		} else {
			trace ("getIncomingTransactionsForAccount(\""+btc_account+"\") service responded with: "+error);
		}
		if (generator != null) {
			generator.next(transactions);
		}
	});
}

/**
* Derives an address from a root HD wallet address. (requires bitcoinjs-lib)
*
* @param rootAddressXPRV The base58 "xprv" HD wallet data.
* @param index The index of the derived address using the default path "m/0'/i" where 'i' is the index value. If 'derivePath'
*	is included this parameter is ignored.
* @param derivePath A custom address derivation path. If provided, 'index' is ignored.
*
* @return An object containing the derived address, keys, and other information.
*/
function deriveAddress(rootAddressXPRV, index, derivePath) {
	if ((derivePath != null) && (derivePath != undefined)) {
		var path = derivePath;
	} else {
		path = "m/0'/"+String(index); //http://bip32.org/ - external account master
	}
	var root = bitcoin.HDNode.fromBase58(rootAddressXPRV);
	var child = root.derivePath(path);
	/*
	//Using bip32-utils:
	var i = child.deriveHardened(0);
	var external = i.derive(0);
	var internal = i.derive(1);
	var account = new bip32.Account([
		new bip32.Chain(external.neutered()),
		new bip32.Chain(internal.neutered())
	])
	trace ("root="+root.getAddress());	
	trace ("account.getChainAddress(0)="+account.getChainAddress(0));
	child.xprv = rootAddressXPRV;
	child.xpub = account.derive(account.getChainAddress(0)).toBase58();
	*/
	/*
	//Using BlockCypher's API:
	//Adds the account created above to BlockCypher as a HD wallet
	request({
		url: "https://api.blockcypher.com/v1/btc/main/wallets/hd?token=fb7cf8296b9143a889913b1ce43688aa",
		method: "POST",
		body: {"name": "dev1", "extended_public_key": "xpub6CKPU4Z2znVZz7vVoadaBird7Pt3mAVVFPtUmkkXqDwrMAbVWRkSD16uLuArpjp3VypKg8reWXm3ygsh7PDGJgKwEdntfX8cmWZz7Fn564x"},
		json: true    
	}, function (error, response, body){
		console.log(error);
		console.log(JSON.stringify(body));
	});
	//get new derived address:
	request({
			url: "https://api.blockcypher.com/v1/btc/main/wallets/hd/dev1/addresses/derive?token=fb7cf8296b9143a889913b1ce43688aa",
			method: "POST",
			json: true    
		}, function (error, response, body){
			console.log(error);
			console.log(JSON.stringify(body));
		});
		
		//{"chains":[{"chain_addresses":[{"address":"19vgSNKNAKFmHzxv4d4K8bm6bhrVc7dhnj","public":"03892a1b527a3786e62dddea187f7c5b2f5eb8a35038beaf838bb02536f5d6dd72","path":"m/0"}]}]}
	*/
	return (child);
}

/**
* Returns a new Bitcoin transaction skeleton object from the BlockCypher API.
*
* @param generator The generator function to invoke when the asynchronous operation completes.
* @param fromAddr The sending address.
* @param toAddr The receiving address.
* @param sathoshis The number of satoshis to send in the transaction.
*/
function getTxSkeleton (fromAddr, toAddr, sathoshis, generator, type) {
	var netwk = type || "btc";		
	request({
		url: "https://api.blockcypher.com/v1/"+netwk+'/'+serverConfig.APIInfo.blockcypher.network+"/txs/new?token="+serverConfig.APIInfo.blockcypher.token,
		method: "POST",
		body:{"inputs":[{"addresses":[fromAddr]}], "outputs":[{"addresses":[toAddr], "value": Number(sathoshis)}], "fees":Number(serverConfig.APIInfo.blockcypher.minerFee.toString())},
		json: true  
	}, function (error, response, body){
		if (generator === undefined) {
			console.log('body:');
			console.log(body);
			return body;
		}
		generator.next(body);
	});
}

/**
* Signs a transaction skeleton as generated by the BlockCypher API.
*
* @param txObject The skeleton transaction object generated by BlockCypher with transactions to sign.
* @param signingWIF The Wallet Import Format data to use for signing.
*
* @return The signed skeleton transaction object that may now be sent to the network.
*/
function signTxSkeleton (txObject, signingWIF) {
	if (serverConfig.APIInfo.blockcypher.network == "test3") {
		//testnet
		var key = new bitcoin.ECPair.fromWIF(signingWIF, bitcoin.networks.testnet);
	} else {
		//main network
		key = new bitcoin.ECPair.fromWIF(signingWIF);
	}
	var pubkeys = [];
	var signatures  = txObject.tosign.map(function(tosign) {
		pubkeys.push(key.getPublicKeyBuffer().toString('hex'));
		return key.sign(Buffer.from(tosign, "hex")).toDER().toString("hex");
	});
	txObject.signatures  = signatures;
	txObject.pubkeys     = pubkeys;
	return (txObject);
}


/**
* Sends a raw, signed, skeleton Bitcoin transaction to the network via the BlockCypher API.
*
* @param generator The generator function to call when the asynchronous operation has completed.
* @param txObject The transaction to send.
*/
function sendTransaction(txObject, generator, type) {
	var netwk = type || "btc";		
	request({
		url: "https://api.blockcypher.com/v1/"+netwk+'/'+serverConfig.APIInfo.blockcypher.network+"/txs/send?token="+serverConfig.APIInfo.blockcypher.token,
		method: "POST",
		body: txObject,
		json: true    
	}, function (error, response, body){
		if (generator === undefined) {
			console.log('body:');
			console.log(body);
			return body;
		}
		generator.next(body);
	});
}

//*************************** RPC HANDLERS *************************************

/**
* Main RPC entry point where individual functions are triggered or an error is returned.
*
* @param postData The POST data included with the request.
* @param requestObj The request object (https://nodejs.org/api/http.html#http_class_http_incomingmessage).
* @param requestObj The response object (https://nodejs.org/api/http.html#http_class_http_serverresponse).
*/
function processRequest(postData, requestObj, responseObj) {
	try {
		var requestData=JSON.parse(postData);
	} catch (err) {
		replyError(postData, requestObj, responseObj, null, serverConfig.JSONRPC_PARSE_ERROR, "JSON-RPC data could not be parsed.");
		return;
	}	
	if ((requestData["length"] != null) && (requestData["length"] != undefined)) {
		if (isNaN(requestData.length)) {
			invokeRPCFunction(postData, requestObj, responseObj, null);
		} else {
			if (requestData.length > serverConfig.rpc_options.max_batch_requests) {
				replyError(postData, requestObj, responseObj, null, serverConfig.JSONRPC_INTERNAL_ERROR, "No more than "+serverConfig.rpc_options.max_batch_requests+" batched methods allowed. Request had "+String(requestData.length)+" methods.");
				return;
			}
			var batchResponses = new Object();
			batchResponses.responses = new Array();
			batchResponses.total = requestData.length;
			for (var count = 0; count < requestData.length; count++) {
				invokeRPCFunction(JSON.stringify(requestData[count]), requestObj, responseObj, batchResponses);
			}
		}
	} else {
		invokeRPCFunction(postData, requestObj, responseObj, null);
	}	
}

/**
* Invokes an individual RPC function.
*
* @param postData The POST data included with the request.
* @param requestObj The request object (https://nodejs.org/api/http.html#http_class_http_incomingmessage).
* @param requestObj The response object (https://nodejs.org/api/http.html#http_class_http_serverresponse).
* @param batchResponses An object containing expected responses for a batch. If null, this function is not being called as part of a batch. Usually the contents of this
* 			object are handled by the HTTP request processor and responder and so should not be updated.
*/
function invokeRPCFunction(postData, requestObj, responseObj, batchResponses) {
	var requestData=JSON.parse(postData);
	if (requestData.jsonrpc != "2.0") {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_REQUEST_ERROR, "Not a valid JSON-RPC 2.0 request. Request object must contain \"jsonrpc\":\"2.0\".");
		return;
	}
	if (requestData["method"] == undefined) {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_REQUEST_ERROR, "Not a valid JSON-RPC 2.0 request. Request object must include a \"method\" endpoint.");	
		return;
	}
	if (requestData["method"] == null) {
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_REQUEST_ERROR, "Not a valid JSON-RPC 2.0 request. The \"method\" endpoint must not be Null.");	
		return;
	}
	try {
		trace ("invokeRPCFunction(\""+requestData.method+"\") -> "+requestObj.socket.remoteAddress+":"+requestObj.socket.remotePort);
	} catch (err) {
		//will this ever happen? should we throw an exception?
		trace ("invokeRPCFunction(\""+requestData.method+"\") request from unknown host.");		
	}
	requestData.method = new String(requestData.method);
	if (requestData.method.split(" ").join("").indexOf("rpc:") == 0) {
		trace ("   ...rejected \"rpc:\" system extension call is unsupported.");
		replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_REQUEST_ERROR, "System extensions (\"rpc:\" methods) are not currently supported.");	
		return;
	}
	try {
		var gen;		
		switch (String(requestData.method)) {
			case "newAccount": 
				gen = RPC_newAccount(postData, requestObj, responseObj, batchResponses);
				gen.next();
				gen.next(gen);
				break;
			case "getBalance":
				gen = RPC_getBalance(postData, requestObj, responseObj, batchResponses);
				gen.next();
				gen.next(gen);
				break;
			case "sendTransaction": 
				gen = RPC_sendTransaction(postData, requestObj, responseObj, batchResponses);
				gen.next();
				gen.next(gen);
				break;
			case "pushToColdStorage":
				gen = RPC_pushToColdStorage(postData, requestData, responseObj, batchResponses);
				gen.next();
				gen.next(gen);
				break;
			default:
				replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_METHOD_NOT_FOUND_ERROR, "Method \""+requestData.method+"\" not yet implemented.");			
				break;
				
		}
	} catch (err) {	
		trace (err);
		var messageSplit = String(err.message).split(":::");
		if (messageSplit.length == 1) {
			replyError(postData, requestObj, responseObj, batchResponses, serverConfig.JSONRPC_INTERNAL_ERROR, "There was a fatal error while processing the request.", err.message);
		} else {
			replyError(postData, requestObj, responseObj, batchResponses, parseInt(messageSplit[0]), messageSplit[1]);
		}
	}
}

/**
*
* @param postData The POST data included with the request.
* @param requestObj The request object (https://nodejs.org/api/http.html#http_class_http_incomingmessage).
* @param responseObj The response object (https://nodejs.org/api/http.html#http_class_http_serverresponse).
* @param batchResponses An object containing expected responses for a batch. If null, this function is not being called as part of a batch. Usually the contents of this
* 			object are handled by the HTTP request processor and responder and so should not be updated.
* @param code A Number that indicates the error type that occurred. This MUST be an integer.
* @param message A String providing a short description of the error. The message SHOULD be limited to a concise single sentence.
* @param data A Primitive or Structured value that contains additional information about the error. This may be omitted.
* The value of this member is defined by the Server (e.g. detailed error information, nested errors etc.).
*/
function replyError(postData, requestObj, responseObj, batchResponses, code, message, data) {	
	try {
		var requestData=JSON.parse(postData);
	} catch (err) {
		requestData = new Object();
	}
	var responseData = new Object();
	responseData.jsonrpc = "2.0";
	if ((requestData["id"] == null) || (requestData["id"] == null)) {
		responseData.id = null;
	} else {
		responseData.id = requestData.id;
	}
	responseData.error = new Object();
	responseData.error.code = code;
	responseData.error.message = message;
	if (data != undefined) {
		responseData.error.data = data;
	}
	if (batchResponses != null) {			
		batchResponses.responses.push(responseData);				
		if (batchResponses.total == batchResponses.responses.length) {
			try {
				setDefaultHeaders(responseObj);
			} catch (error) {
				console.log(error);
			}
			responseObj.end(JSON.stringify(batchResponses.responses));
		}
	} else {
		try {
			setDefaultHeaders(responseObj);
		} catch (error) {
			console.log(error);
		}
		responseObj.end(JSON.stringify(responseData));
	}	
}

/**
* @param postData The POST data included with the request.
* @param requestObj The request object (https://nodejs.org/api/http.html#http_class_http_incomingmessage).
* @param requestObj The response object (https://nodejs.org/api/http.html#http_class_http_serverresponse).
* @param batchResponses An object containing expected responses for a batch. If null, this function is not being called as part of a batch. Usually the contents of this
* 			object are handled by the HTTP request processor and responder and so should not be updated.
* @param result The result of the RPC method.
*/
function replyResult(postData, requestObj, responseObj, batchResponses, result) {
	try {
		var requestData=JSON.parse(postData);
	} catch (err) {
		requestData = new Object();
	}
	var responseData = new Object();
	responseData.jsonrpc = "2.0";
	if ((requestData["id"] == null) || (requestData["id"] == null)) {
		responseData.id = null;
	} else {
		responseData.id = requestData.id;
	}
	responseData.result = result;	
	if (batchResponses != null) {
		batchResponses.responses.push(responseData);		
		if (batchResponses.total == batchResponses.responses.length) {
			setDefaultHeaders(responseObj);			
			responseObj.end(JSON.stringify(batchResponses.responses));
		}
	} else {
		setDefaultHeaders(responseObj);		
		responseObj.end(JSON.stringify(responseData));
	}
}

/**
* Adds the default HTTP headers, as defined in serverConfig.rpc_options.headers, to a response object.
*
* @param The response object to add default headers to.
*/
function setDefaultHeaders(responseObj) {
	try {
		for (var count=0; count < serverConfig.rpc_options.headers.length; count++) {
			var headerData = serverConfig.rpc_options.headers[count];
			for (var headerType in headerData) {
				responseObj.setHeader(headerType, headerData[headerType]);
			}
		}
	} catch (error) {
		trace("error setting headers: " + error);
	}
}

/**
* Checks for the existence of a parameter within supplied request data. If the parameter does not appear (undefined), an error
* if thrown in the format serverConfig.JSONRPC_INVALID_PARAMS_ERROR+":::Descriptive error message"
*
* @param requestData The data to check for the existence of the parameter (only the top level of the request object is examined)
* @param param The parameter to check for.
*/
function checkParameter(requestData, param) {
	if ((requestData["params"] == null) || (requestData["params"] == null)) {
		var err = new Error(serverConfig.JSONRPC_INVALID_PARAMS_ERROR+":::Required \"params\" not found in request.");
		throw (err);
	}
	if (requestData.params[param] == undefined) {
		err = new Error(serverConfig.JSONRPC_INVALID_PARAMS_ERROR+":::Required parameter \""+param+"\" not found in request.");
		throw (new Error(err));
	}
}

//*************************** STARTUP / GLOBAL FUNCTIONS *************************************

/**
* Stand-in logging function that adds additional debugging information to the console.
*/
function trace(msg) {
	try {
		var traceMsg = "";
		var dateStamp="";
		var dateObj = new Date(); //now
		dateStamp = String(dateObj.getFullYear())+"-";
		dateStamp += String(dateObj.getMonth()+1)+"-";
		dateStamp += String(dateObj.getDate())+" ";
		dateStamp += String(dateObj.getHours())+":";
		dateStamp += String(dateObj.getMinutes())+":";
		dateStamp += String(dateObj.getSeconds())+".";
		dateStamp += String(dateObj.getMilliseconds());		
		traceMsg += "["+dateStamp+"] ";
		traceMsg += msg;
		console.log(traceMsg);
	} catch (err) {
	}
}

/**
* Main function invoked when the dabase connector (db), successfully connects.
*
* @param connection The main connection object provided by the database connector.
*
*/
function onConnect(connection) {
	trace("Database connection established on thread: "+connection.threadId);
	startRPCServer();
}

/**
* Main function invoked when the dabase connector (db), fails to connect.
*
* @param connection The main connection object provided by the database connector that could not establish a connection.
*
*/
function onConnectFail(connection) {
	trace ("Database connection failed! Is MySQL daemon running?");
}

/**
* Attempts to start the main JSON-RPC server daemon script.
*/
function startRPCServer() {
	trace ("Starting Cryptocucurrency Gateway Services JSON-RPC server...");
	rpc_server = http.createServer(handleHTTPRequest);
	//rpc_server = https.createServer(handleHTTPRequest);
	try {
		rpc_server.listen(serverConfig.rpc_options.port, onRPCServerStart);
	} catch (err) {
		trace ("The requested port ("+serverConfig.rpc_options.port+") is already in use.");
	}
}


/**
* Function invoked when the RPC server has been started or an error occured.
*
* @param error An error object specifiying the startup error, of null if successfully started.
*/
function onRPCServerStart() {
	trace ("JSON-RPC server is listening on port "+serverConfig.rpc_options.port+".");
}

/**
* Handles an HTTP request, usually assigned through `http.createServer(handleHTTPRequest)`
*
* @param requestObj HTTP request object (https://nodejs.org/api/http.html#http_class_http_incomingmessage).
* @param responseObj HTTP response object (https://nodejs.org/api/http.html#http_class_http_serverresponse).
*/
function handleHTTPRequest(requestObj, responseObj){	
	//only headers received at this point so read following POST data in chunks...
	if (requestObj.method == 'POST') {  
		var postData=new String();
		requestObj.on('data', function(chunk) {
			//reading message body...
			if ((chunk!=undefined) && (chunk!=null)) {
				postData+=chunk;
			}
		});		
		requestObj.on('end', function() {		  
			//message body fully read
			processRequest(postData, requestObj, responseObj)
		});
	 }    
}

/**
* Shuts down the server and all opened connections / databases / etc.
*/
function shutdown() {
	db.closeAll();
}

//***************************** MAIN START *****************************************

//Start the database connection
db.connect(onConnect, onConnectFail);
	
