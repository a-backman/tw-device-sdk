import 'reflect-metadata';
import got from 'got';
import {
	decode
} from 'jsonwebtoken';
import { validatedPlainToClass } from '@marcj/marshal';
import { ClassType } from "@marcj/estdlib";
import {
	existsSync,
	readFileSync,
	writeFileSync,
	unlinkSync,
} from 'fs';
import { join } from 'path';
import {
	ActuatorModel,
	BooleanSensorModel,
	DeviceModel,
	InstrumentModel,
	LoRaWanDeviceModel,
	MetadataModel,
	NumberSensorModel,
	PositionSensorModel,
	StringSensorModel,
	VirtualDeviceModel,
} from './models/device.model';
import {
	User
} from './models/auth0.model';

export {
	DeviceModel,
	NumberSensorModel,
	StringSensorModel,
	BooleanSensorModel,
	PositionSensorModel,
	MetadataModel,
} from './models/device.model';


class AccessToken extends User {
	public jwt: string;

	constructor(jwt: string) {
		super(decode(jwt));
		this.jwt = jwt;
	}
}

export class Client {

	private baseURL: string;
	private jwt: string;
	private identity: string;

	private getDeviceClassType(plain: DeviceModel): ClassType<DeviceModel> {
		switch (plain.type) {
			case 'LoRaWan':
				return LoRaWanDeviceModel;
			case 'Virtual':
				return VirtualDeviceModel;
			default:
				console.log('Unkown device type:', plain.type, plain);
		}
	}

	private getInstrumentClassType(plain: InstrumentModel): ClassType<InstrumentModel> {
		switch (plain.dataType) {
			case 'position':
				return PositionSensorModel;
			case 'number':
				return NumberSensorModel;
			case 'string':
				return StringSensorModel;
			case 'boolean':
				return BooleanSensorModel;
			case 'actuator':
				return ActuatorModel;
		}
	}

	constructor(baseURL) {
		this.baseURL = baseURL;

	}

	public setAccessToken(accessToken: AccessToken) {
		this.jwt = accessToken.jwt;
		this.identity = accessToken.organizations[0];
	}

	async getDevices(): Promise<DeviceModel[]> {

		return (await got.get(
			`${this.baseURL}/organizations/${this.identity}/devices`, {
			headers: {
				"Content-Type": "application/json",
				'Authorization': `Bearer ${this.jwt}`
			}
		})
			.json<DeviceModel[]>())
			.map(d => validatedPlainToClass(this.getDeviceClassType(d), d));
	}

	async getDevice(deviceId: string) {

		const d = await got.get(
			`${this.baseURL}/organizations/${this.identity}/devices/${deviceId}`, {
			headers: {
				"Content-Type": "application/json",
				'Authorization': `Bearer ${this.jwt}`
			}
		}).json<DeviceModel>();
		if (d)
			return validatedPlainToClass(this.getDeviceClassType(d), d)
	}

	async getMetadata(deviceId: string): Promise<MetadataModel[]> {

		const d = await got.get(
			`${this.baseURL}/organizations/${this.identity}/devices/${deviceId}/metadata`, {
			headers: {
				"Content-Type": "application/json",
				'Authorization': `Bearer ${this.jwt}`
			}
		}).json<MetadataModel[]>();
		if (d)
			return d; // FIXME, this breaks when using validatedPlainToClass
		return [];
	}

	async createDevice(deviceName: string, manufacturer: string, persistData: boolean = true) {
		const device = validatedPlainToClass(
			VirtualDeviceModel,
			{
				manufacturer: manufacturer,
				name: deviceName,
				organizationId: this.identity,
				persistData: persistData,
				type: 'Virtual',
			}
		)

		const d = await got.post(
			`${this.baseURL}/organizations/${this.identity}/devices`, {
			headers: {
				"Content-Type": "application/json",
				'Authorization': `Bearer ${this.jwt}`
			},
			json: device
		}
		).json<DeviceModel>()
		if (d)
			return validatedPlainToClass(this.getDeviceClassType(d), d)
	}

	async createMetadata(deviceId: string, key: string, value: string | number, readonly: boolean = false) {

		const md = new MetadataModel();
		md.key = key;
		md.value = value.toString();
		md.readonly = readonly;

		const d = await got.post(
			`${this.baseURL}/organizations/${this.identity}/devices/${deviceId}/metadata`, {
			headers: {
				"Content-Type": "application/json",
				'Authorization': `Bearer ${this.jwt}`
			},
			json: md
		}
		).json<MetadataModel>()
		if (d)
			return validatedPlainToClass(MetadataModel, d)
	}

	async createInstrument(deviceId: string, instrument: InstrumentModel) {
		const i = await got.post(
			`${this.baseURL}/organizations/${this.identity}/devices/${deviceId}/instruments`, {
			headers: {
				"Content-Type": "application/json",
				'Authorization': `Bearer ${this.jwt}`
			},
			json: instrument
		}).json<InstrumentModel>();
		if (i)
			return validatedPlainToClass(this.getInstrumentClassType(i), i);
	}

	async deleteDevice(deviceId: string) {
		const d = await got.delete(
			`${this.baseURL}/organizations/${this.identity}/devices/${deviceId}`, {
			headers: {
				"Content-Type": "application/json",
				'Authorization': `Bearer ${this.jwt}`
			}
		}).json<DeviceModel>();
		console.log('Deleted', d);
		return d;
		// if (d[0])
		// 	return validatedPlainToClass(this.getDeviceClassType(d[0]), d[0]);
	}

	async publishData(deviceId: string, data: { [key: string]: any }) {
		return await got.post(
			`${this.baseURL}/organizations/${this.identity}/devices/${deviceId}/data`, {
			headers: {
				"Content-Type": "application/json",
				'Authorization': `Bearer ${this.jwt}`
			},
			json: data
		}).json()
	}

}

const tokenFile = join(__dirname, '../token.txt');


export class SDK {

	private baseURL: string;
	private auth0Domain: string;

	private async getToken(clientId: string, clientSecret: string): Promise<string> {
		if (existsSync(tokenFile)) {
			console.log('Got token from file');
			return readFileSync(tokenFile).toString();
		} else {
			console.log('Requesting new token');
			const token = await got.post(
				`${this.auth0Domain}/oauth/token`, {
				json: {
					grant_type: 'client_credentials',
					client_id: clientId,
					client_secret: clientSecret,
					audience: 'https://api.thingsweb.com'
				}
			}).json<any>();
			writeFileSync(tokenFile, token.access_token);
			return token.access_token;
		}
	}

	private scheduleTokenRenewal(timeRemaining: number, client: Client, clientId: string, clientSecret: string) {
		console.log('There are', timeRemaining, 'milliseconds remaining on token');
		setTimeout(async () => {
			unlinkSync(tokenFile);
			await this.assignToken(client, clientId, clientSecret);
		}, timeRemaining)
	}

	private async assignToken(client: Client, clientId: string, clientSecret: string) {
		const accessToken = new AccessToken(await this.getToken(clientId, clientSecret));
		client.setAccessToken(accessToken);
		this.scheduleTokenRenewal(accessToken.exp - Date.now(), client, clientId, clientSecret);
	}

	constructor(baseURL, auth0Domain = "https://verithings.auth0.com") {
		this.baseURL = baseURL;
		this.auth0Domain = auth0Domain;
	}

	public async init(clientId: string, clientSecret: string) {
		const client = new Client(this.baseURL);
		await this.assignToken(client, clientId, clientSecret);
		return client;
	}
}
