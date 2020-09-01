const api_id = API_ID;
const api_hash = API_HASH;

const { MTProto } = require('@mtproto/core');

const mtproto = new MTProto({
  api_id: api_id,
  api_hash: api_hash,
});

const api = {
  call(method, params, options = {}) {
    
    return mtproto.call(method, params, options).catch(async error => {
      const { error_code, error_message } = error;

      if (error_code === 303) {
        const [type, dcId] = error_message.split('_MIGRATE_');
        
        // If auth.sendCode call on incorrect DC need change default DC, because call auth.signIn on incorrect DC return PHONE_CODE_EXPIRED error
        if (type === 'PHONE') {
          await mtproto.setDefaultDc(+dcId);
        } else {
          options = {
            ...options,
            dcId: +dcId,
          };
        }

        return this.call(method, params, options);
      }

      return Promise.reject(error);
    });
  },
};

function sendCode(phone) {
    return api.call('auth.sendCode', {
      phone_number: phone,
      settings: {
        _: 'codeSettings',
      },
    });
}

function signIn({ code, phone, phone_code_hash }) {
    return api.call('auth.signIn', {
      phone_code: code,
      phone_number: phone,
      phone_code_hash: phone_code_hash,
    });
}

function getPassword() {
    return api.call('account.getPassword');
}
  
async function checkPassword({ srp_id, A, M1 }) {
    return api.call('auth.checkPassword', {
        password: {
        _: 'inputCheckPasswordSRP',
        srp_id,
        A,
        M1,
        },
    });
}
////

function getInput(str){
  return new Promise((resolve,reject)=>{
    const readline = require("readline").createInterface({
      input:process.stdin,
      output:process.stdout
    });
  
    readline.question(str+" : ",ans=>{
      resolve(ans);
    });
  
  });
}

async function auth(){

    try {
      await api.call('account.getAccountTTL');
      return;
    }
    catch(e){
      console.log("auth required");  
    }

    const { getSRPParams } = require('@mtproto/core');

    const phone = await getInput("Enter Phone number with country code");
    let code = '30786';
    const password = 'PASSWORD';

    try{
        const sendCodeRes = await sendCode(phone);
        console.log(sendCodeRes);
        code = await getInput("Enter the code");
        return signIn({
            code,
            phone,
            phone_code_hash: sendCodeRes.phone_code_hash,
        });
    }
    catch(e){
        if(e.error_message === 'SESSION_PASSWORD_NEEDED') {
            const getPassRes = await getPassword();
            const { srp_id, current_algo, srp_B } = getPassRes;
            const { g, p, salt1, salt2, } = current_algo;
            const { A, M1 } = await getSRPParams({
                g,
                p,
                salt1,
                salt2,
                gB: srp_B,
                password,
            });
    
            return checkPassword({ srp_id, A, M1 });
        }  
        throw e;   
    }

}

async function main(username,msg_offset,file_destination){
    msg_offset=parseInt(msg_offset);
    try{
        let res = await api.call('contacts.resolveUsername',{
            username:username
        });

        try {
          res = await api.call('messages.getHistory',{            
            peer:{_:'inputPeerChannel',channel_id:res.peer.channel_id,access_hash:res.chats[0].access_hash},
            limit:1,
            offset_id:msg_offset+1
          });
        }
        catch(e){
          throw e;
        }

        if(!res.messages[0].media || !res.messages[0].media.document){
          console.log(res.messages[0]);
          console.log("No file present");
          throw 'No File Present';
        }

        const attr = res.messages[0].media.document.attributes;
        
        if(attr[0]._=="documentAttributeVideo"){
          file_destination+='telegram_video.mp4';
        }
        else if(attr[0]._=='documentAttributeFilename') {
          //console.log(attr);
          file_destination+=attr[0].file_name;
        }
        else {
          file_destination+='file';
        }

        const inputFileLocation = {
          _:'inputDocumentFileLocation',
          id:res.messages[0].media.document.id,
          access_hash:res.messages[0].media.document.access_hash,
          file_reference:res.messages[0].media.document.file_reference,
        };
        
        try {
          if(require("fs").existsSync(file_destination)){
            require("fs").unlinkSync(file_destination);
          }
          await getFile(inputFileLocation,0,file_destination);
          console.log("done");
        }
        catch(e){
          console.log("err");
          throw e;
        }
    }
    catch(e){
        console.log("err");
        throw e;
    }
}

async function getFile(inputFileLocation,offset,file_destination){
  let res;
  try {
    res = await api.call('upload.getFile',{
      location:inputFileLocation,
      offset:offset?offset:0,
      limit:1024*1024,
      precise:{_:'true'}
    });
  }
  catch(e){
    return;
  }
  require("fs").appendFileSync(file_destination,res.bytes);
  console.log( (( (offset?offset:0) +res.bytes.length)/(1024*1024)) +" MB");
  if(res.type._=="storage.filePartial"){
    return await getFile(inputFileLocation,(offset?offset:0)+res.bytes.length,file_destination);
  }
  else {
    console.log(res.type._);
    return;
  }
}

auth();

/**
 * 
 * @param {String} link Link of Telegram message containing file 
 * @param {String} file_destination destination directory for the file  
 */
exports.download = async (link,file_destination)=>{
  link = link.split(/[\//]/i);
  const msg_offset = link.pop();
  const username = link.pop();

  try {
    await main(username,msg_offset,file_destination);
    return true;
  }
  catch(e){
    throw e;
  }
};

(async()=>{

  try {
    await exports.download('https://t.me/marioworlds/1860',"./");
  }
  catch(e){
    console.log("Invalid Link ",e);
  }

})();
