const request = require('request-promise-native');
const jwt = require('jsonwebtoken');

const baseURL = 'https://api.thingsweb.io';

class Client {

	setAccessToken(accessToken) {

		const token = jwt.decode(accessToken);
		this.accessToken = accessToken;
		this.scopes = token.scope ? token.scope.split(' ') : [];
		this.identity = token['http://thingsweb.com/groups'][0];
	}

	async getDevices() {

		return await request.get(
			`${baseURL}/organizations/${this.identity}/devices`, {
				headers: {
					"Content-Type": "application/json",
					'Authorization': `Bearer ${this.accessToken}`
				}
			}
		)
	}

	async createDevice(deviceName, instruments = {}, metadata = {}) {
		const device = {
			organizationId: this.identity,
			name: deviceName,
			instruments: instruments,
			metadata: metadata,
			type: 'Virtual'
		}
		return await request.post(
			`${baseURL}/organizations/${this.identity}/devices`, {
				headers: {
					"Content-Type": "application/json",
					'Authorization': `Bearer ${this.accessToken}`
				},
				json: device
			}
		)
	}

	async deleteDevice(deviceId) {
		return await request.delete(
			`${baseURL}/organizations/${this.identity}/devices/${deviceId}`, {
				headers: {
					"Content-Type": "application/json",
					'Authorization': `Bearer ${this.accessToken}`
				}
			}
		)
	}

	async publishData(deviceId, data) {
		return await request.post(
			`${baseURL}/organizations/${this.identity}/devices/${deviceId}/data`, {
				headers: {
					"Content-Type": "application/json",
					'Authorization': `Bearer ${this.accessToken}`
				},
				json: data
			}
		)
	}

}

class SDK {
	async initWithCredentials(clientId, clientSecret) {
		const body = await request.post(
			'https://verithings.auth0.com/oauth/token', {
				json: {
					client_id: clientId,
					client_secret: clientSecret,
					audience: "https://api.thingsweb.com",
					grant_type: "client_credentials"
				}
			});
		setTimeout(() => {
			this.authenticateClient(clientId, clientSecret);
		}, body.expires_in * 1000);

		return this.initWithToken(body.access_token);
	}

	async initWithToken(token) {
		const client = new Client();
		client.setAccessToken(token);
		return client;
	}
}

module.exports = SDK;