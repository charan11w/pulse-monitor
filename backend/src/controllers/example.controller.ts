import {Request,Response} from 'express';

export const exampleController=(req:Request,res:Response)=>{
  return res.status(200).json({
    success:true,
    data:req.body
  })
}