import { Transaction as EthTx, TxData } from 'ethereumjs-tx';
import { addHexPrefix, toBuffer, hashPersonalMessage } from 'ethereumjs-util';
import mapValues from 'lodash/mapValues';

import { translateRaw } from '@translations';
import { getTransactionFields } from '@services/EthService';
import { stripHexPrefixAndLower, padLeftEven } from '@services/EthService/utils';
import { HardwareWallet, ChainCodeResponse } from './hardware';

const WebSocket = require('isomorphic-ws');

export class SatochipWallet extends HardwareWallet {
  public static isConnected: boolean;
  public static resolveMap: Map<number, any>;
  public static requestID: number;
  public static ws: WebSocket;
  public static reconnectInterval: number;
  public static connect: any;

  //why static?
  public static getChainCode(dpath: string): Promise<ChainCodeResponse> {
    console.log('Satochip: v2/services/WalletService/deterministic/Satochip.ts: in getChainCode()'); //debugSatochip

    return SatochipWallet.connect().then((ws: any) => {
      //const fullpath: string= dpath+"/0";
      console.log('Satochip: v2/services/WalletService/Satochip.ts: in connect().then()'); //debugSatochip
      const msg: any = {
        requestID: SatochipWallet.requestID++,
        action: 'get_chaincode',
        path: dpath
      };
      const request: string = JSON.stringify(msg);

      return new Promise((resolve) => {
        const ccr = {} as ChainCodeResponse;
        // send request to device and keep a ref of the resolve function in a map
        const response = new Promise((resolve2) => {
          console.log('Satochip: resolveMap.size - before:' + SatochipWallet.resolveMap.size);
          SatochipWallet.resolveMap.set(msg.requestID, resolve2);
          //SatochipWallet.ws.send(request);
          ws.send(request);
          console.log('Satochip: request sent:' + request);
          console.log('Satochip: typeof(resolve2):' + typeof resolve2);
          console.log('Satochip: resolveMap.size - after:' + SatochipWallet.resolveMap.size);
        }).then((res: any) => {
          // extracts usefull data from device response and resolve original promise
          ccr.chainCode = res.chaincode;
          ccr.publicKey = res.pubkey;
          resolve(ccr);
        });
      });
    });
  }

  //todo: remove?
  constructor(address: string, dPath: string, index: number) {
    super(address, dPath, index);
    console.log('Satochip: v2/services/WalletService/Satochip.ts: in constructor()');
  }

  public signRawTransaction(tx: EthTx): Promise<Buffer> {
    console.log('Satochip: services/WalletService/Satochip.ts: in signRawTransaction()');
    if (!SatochipWallet.isConnected) {
      SatochipWallet.connect();
    }

    //debug: getpath
    console.log('getpath:' + this.getPath());
    console.log('fullpath:' + this.dPath + '/' + this.index);
    console.log('tx:' + tx.toJSON());
    console.log('tx.chainId:' + tx.getChainId()); //console.log('tx._chainId:' + tx._chainId);
    console.log('serializedTx: ' + tx.serialize().toString('hex'));
    console.log('serializedTx hash(false) : ' + tx.hash(false).toString('hex'));
    console.log('serializedTx hash(true) : ' + tx.hash(true).toString('hex'));

    // Disable EIP155 in Ethereumjs-tx
    const transaction = new EthTx(tx, { chain: tx.getChainId(), hardfork: 'tangerineWhistle' });
    const txFields = getTransactionFields(transaction);
    transaction.v = toBuffer(transaction.getChainId());
    transaction.r = toBuffer(0);
    transaction.s = toBuffer(0);
    console.log('transaction: ' + transaction.toJSON());
    console.log('transaction: ' + transaction.toJSON(true));

    const msg: any = {
      requestID: SatochipWallet.requestID++,
      action: 'sign_tx_hash',
      tx: transaction.serialize().toString('hex'), //tx.serialize().toString('hex'), //DEBUGTMP
      hash: transaction.hash(true).toString('hex'), //hash: transaction.hash(false).toString('hex'),
      path: this.getPath()
    };
    const request: string = JSON.stringify(msg);

    return new Promise((resolve) => {
      // send request to device and keep a ref of the resolve function in a map
      const response = new Promise((resolve2) => {
        console.log('Satochip: resolveMap.size - before:' + SatochipWallet.resolveMap.size);
        SatochipWallet.resolveMap.set(msg.requestID, resolve2);
        SatochipWallet.ws.send(request);
        console.log('Satochip: request sent:' + request);
        console.log('Satochip: resolveMap.size - after:' + SatochipWallet.resolveMap.size);
      }).then((res: any) => {
        // extracts usefull data from device response and resolve original promise
        console.log('Satochip: reply: v: ' + res.v);
        console.log('Satochip: reply: r: ' + res.r);
        console.log('Satochip: reply: s: ' + res.s);
        try {
          const { chainId, ...strTx } = getTransactionFields(tx);
          if (parseInt(res.v, 16) <= 1) {
            //if (Number(res.v) <= 1) {
            //  for larger chainId, only signature_v returned. simply recalc signature_v
            res.v = parseInt(res.v, 16) + 2 * chainId + 35; //res.v += 2 * chainId + 35;
          }

          const txToSerialize: TxData = {
            ...strTx,
            v: res.v,
            r: Buffer.from(res.r, 'hex'), //res.r,
            s: Buffer.from(res.s, 'hex') //res.s
          };
          // Disable EIP155 in Ethereumjs-tx
          const eTx = new EthTx(txToSerialize, {
            chain: tx.getChainId(),
            hardfork: 'tangerineWhistle'
          }); //const eTx = new EthTx(txToSerialize);
          const serializedTx = eTx.serialize();
          resolve(serializedTx);
          console.log('Satochip: serializedTx: ' + serializedTx.toString('hex'));
          console.log('Satochip: serializedTx hash(false) : ' + eTx.hash(false).toString('hex'));
          console.log('Satochip: serializedTx hash(true) : ' + eTx.hash(true).toString('hex'));
        } catch (err) {
          console.log(err);
        }
      });
    });
  }

  public signMessage(msgs: string): Promise<string> {
    console.log('Satochip: services/WalletService/Satochip.ts: signMessage()');
    if (!msgs) {
      throw Error('No message to sign');
    }
    if (!SatochipWallet.isConnected) {
      SatochipWallet.connect();
    }

    const data: any = {
      requestID: SatochipWallet.requestID++,
      action: 'sign_msg_hash',
      msg: msgs,
      hash: hashPersonalMessage(toBuffer(msgs)).toString('hex'),
      path: this.getPath()
    };
    const request: string = JSON.stringify(data);

    return new Promise((resolve) => {
      // send request to device and keep a ref of the resolve function in a map
      const response = new Promise((resolve2) => {
        SatochipWallet.resolveMap.set(data.requestID, resolve2);
        SatochipWallet.ws.send(request);
        console.log('Satochip: request sent:' + request);
      }).then((res: any) => {
        // extracts usefull data from device response and resolve original promise
        const r = res.r;
        const s = res.s;
        const v = ('0' + res.v.toString(16)).slice(-2); //padd with '0'
        const combined = addHexPrefix(r + s + v);
        resolve(combined);
      });
    });
  }

  public displayAddress(): Promise<boolean> {
    console.log(
      'Satochip: services/WalletService/deterministic/Satochip.ts: displayAddress() not implemented'
    );
    return Promise.reject(new Error('displayAddress via Satochip not supported.'));
  }

  public getWalletType(): string {
    console.log('Satochip: in services/WalletService/deterministic/Satochip.ts: getWalletType()');
    return translateRaw('X_SATOCHIP');
  }
}

SatochipWallet.isConnected = false;
SatochipWallet.requestID = 0;
SatochipWallet.resolveMap = new Map();
SatochipWallet.reconnectInterval = (1 * 1000 * 60) / 4;
SatochipWallet.connect = () => {
  console.log('Satochip: services/WalletService/deterministic/Satochip.ts: connect()');

  return new Promise((resolve) => {
    if (!SatochipWallet.isConnected) {
      SatochipWallet.ws = new WebSocket('ws://localhost:8397/');

      SatochipWallet.ws.onopen = function open() {
        console.log('connected');
        SatochipWallet.isConnected = true;
        //TODO: remove get_status as it is not used?
        const msg: any = { requestID: SatochipWallet.requestID++, action: 'get_status' };
        const data: string = JSON.stringify(msg);

        SatochipWallet.ws.send(data);
        console.log('Request:' + data);

        resolve(SatochipWallet.ws);
      };

      SatochipWallet.ws.onmessage = function incoming(data: any) {
        console.log('in /common/v2/services/WalletService/deterministic/satochip.ts'); //debugSatochip
        console.log('ONMESSAGE: message received!');
        console.log('Reply:' + data.data); // should be string

        const response = JSON.parse(data.data);
        console.log('Reply JSON:', response);
        console.log('Reply requestID:', response.requestID);

        try {
          console.log(
            'Assert: resolveMap has key: ' +
              response.requestID +
              '?' +
              SatochipWallet.resolveMap.has(response.requestID)
          );
          if (SatochipWallet.resolveMap.has(response.requestID)) {
            console.log(
              'typeof(resolveMap.get()):' + typeof SatochipWallet.resolveMap.get(response.requestID)
            );
            SatochipWallet.resolveMap.get(response.requestID)(response);
            SatochipWallet.resolveMap.delete(response.requestID);
          }
        } catch (error) {
          console.error(error);
        }
      };

      SatochipWallet.ws.onclose = function close(event) {
        console.log('disconnected with code:' + event.code);
        SatochipWallet.isConnected = false;
        setTimeout(SatochipWallet.connect, SatochipWallet.reconnectInterval);
      };

      SatochipWallet.ws.onerror = function error() {
        console.log('disconnected with error!');
        SatochipWallet.isConnected = false;
      };
    } else {
      resolve(SatochipWallet.ws);
    }
  });
}; //end connect()

// start connection as soon as MyCrypto launches
//console.log('Satochip: run SatochipWallet.connect() ');
//SatochipWallet.connect();
