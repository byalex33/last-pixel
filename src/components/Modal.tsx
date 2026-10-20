import React from 'react'
import { Btn } from './Btn';

const Modal = ({ text, onAccept, onDecline }: { text: string, onAccept: () => void, onDecline: () => void }) => {
    return (
        <div className='modal hover-modal'>
            <h1>
                {text}
            </h1>
            <div className='hover-modal-buttons'>
                <Btn variant='primary' onClick={() => onAccept()}>
                    Accept
                </Btn>
                <Btn onClick={() => onDecline()}>
                    Decline
                </Btn>
            </div>
        </div>
    )
}

export default Modal;
