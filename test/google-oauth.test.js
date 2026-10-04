const { test } = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {authorizeGoogle, parseGoogleClient, refreshGoogleTokens, googleSpreadsheets, googleConnection} = require('../dist/connections/google-oauth');
const client={clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture-secret'};
test('desktop sign-in validates state and exchanges PKCE code without exposing tokens to browser', async () => {
 let auth;
 const tokens=await authorizeGoogle(client, async value => {
  auth=new URL(value); const callback=new URL(auth.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname,'127.0.0.1'); assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  callback.search=new URLSearchParams({state:'wrong',code:'evil'}).toString();
  assert.equal((await fetch(callback)).status,400);
  callback.search=new URLSearchParams({state:auth.searchParams.get('state'),code:'code-fixture'}).toString();
  const text=await (await fetch(callback)).text(); assert.ok(!text.includes('code-fixture'));
  return true;
 }, undefined, async (url,options) => {
  assert.equal(url,'https://oauth2.googleapis.com/token');
  const params=new URLSearchParams(options.body);
  assert.equal(params.get('code'),'code-fixture');
  assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'),auth.searchParams.get('code_challenge'));
  return Response.json({access_token:'access-fixture',refresh_token:'refresh-fixture',expires_in:3600});
 });
 assert.equal(tokens.refreshToken,'refresh-fixture'); assert.ok(tokens.expiresAt>Date.now());
});
test('browser rejection and cancellation clean up the callback server', async () => {
 await assert.rejects(authorizeGoogle(client,async()=>false),/Could not open/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(authorizeGoogle(client,async()=>{throw Error('must not open')},controller.signal),/cancelled/);
});
test('OAuth setup requires a desktop client; refresh and spreadsheet pagination retain credentials', async () => {
 assert.deepEqual(parseGoogleClient({installed:{client_id:client.clientId,client_secret:client.clientSecret}}),client);
 assert.throws(()=>parseGoogleClient({web:{client_id:client.clientId}}),/Desktop app/);
 const tokens=await refreshGoogleTokens(client,{accessToken:'expired',refreshToken:'refresh-fixture',expiresAt:0},async(url,options)=>{
  assert.equal(new URLSearchParams(options.body).get('grant_type'),'refresh_token');
  return Response.json({access_token:'new-fixture',expires_in:3600});
 });
 assert.equal(tokens.refreshToken,'refresh-fixture');let calls=0;
 const sheets=await googleSpreadsheets(tokens,async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer new-fixture');calls++;
  return calls===1?Response.json({nextPageToken:'next',files:[{id:'a',name:'First'}]}):Response.json({files:[{id:'b',name:'Second'}]});
 });
 assert.equal(sheets.length,2); assert.equal(calls,2);
 const uri=googleConnection('a',client,tokens);assert.match(uri,/refreshToken=refresh-fixture/);assert.match(uri,/tokenExpiresAt=/);
});
test('OAuth provider errors do not expose raw token responses', async () => {
 await assert.rejects(refreshGoogleTokens(client,{accessToken:'old',refreshToken:'private-fixture',expiresAt:0},async()=>new Response('private-fixture',{status:400})),error=>!error.message.includes('private-fixture'));
});
