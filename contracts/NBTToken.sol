// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract NBTToken {
    string private _name;
    string private _symbol;
    uint8 private constant _DECIMALS = 18;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    uint256 public constant FEE_BASE = 10_000;
    uint256 public buyFee;
    uint256 public sellFee;
    address public feeReceiver;
    mapping(address => bool) public isPair;
    mapping(address => bool) public isExcludedFromFee;

    address public owner;
    address public pendingOwner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event PairUpdated(address indexed pair, bool status);
    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event FeesUpdated(uint256 buyFee, uint256 sellFee);
    event ExcludedFromFee(address indexed account, bool status);
    event FeeCollected(address indexed from, address indexed to, uint256 amount, bool isSell);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        address feeReceiver_
    ) {
        require(feeReceiver_ != address(0), "Invalid address");
        _name = name_;
        _symbol = symbol_;
        owner = msg.sender;
        feeReceiver = feeReceiver_;
        sellFee = 280;

        isExcludedFromFee[msg.sender] = true;
        isExcludedFromFee[feeReceiver_] = true;
        _mint(msg.sender, initialSupply_);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function decimals() external pure returns (uint8) {
        return _DECIMALS;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address tokenOwner, address spender) external view returns (uint256) {
        return _allowances[tokenOwner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "ERC20: insufficient allowance");
        unchecked {
            _approve(from, msg.sender, currentAllowance - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function calculateSellAmount(uint256 amount) external view returns (uint256 feeAmount, uint256 receiveAmount) {
        feeAmount = amount * sellFee / FEE_BASE;
        receiveAmount = amount - feeAmount;
    }

    function calculateBuyAmount(uint256 amount) external view returns (uint256 feeAmount, uint256 receiveAmount) {
        feeAmount = amount * buyFee / FEE_BASE;
        receiveAmount = amount - feeAmount;
    }

    function getFeeConfig() external view returns (uint256 _buyFee, uint256 _sellFee, address _feeReceiver) {
        return (buyFee, sellFee, feeReceiver);
    }

    function setPair(address pair, bool status) external onlyOwner {
        require(pair != address(0), "Invalid address");
        isPair[pair] = status;
        emit PairUpdated(pair, status);
    }

    function setPairsBatch(address[] calldata pairs, bool status) external onlyOwner {
        for (uint256 i = 0; i < pairs.length; i++) {
            require(pairs[i] != address(0), "Invalid address");
            isPair[pairs[i]] = status;
            emit PairUpdated(pairs[i], status);
        }
    }

    function setFees(uint256 buyFee_, uint256 sellFee_) external onlyOwner {
        require(buyFee_ <= 1_000 && sellFee_ <= 1_000, "Fee too high");
        buyFee = buyFee_;
        sellFee = sellFee_;
        emit FeesUpdated(buyFee_, sellFee_);
    }

    function setFeeReceiver(address feeReceiver_) external onlyOwner {
        require(feeReceiver_ != address(0), "Invalid address");
        address oldReceiver = feeReceiver;
        feeReceiver = feeReceiver_;
        isExcludedFromFee[feeReceiver_] = true;
        emit FeeReceiverUpdated(oldReceiver, feeReceiver_);
    }

    function setExcludedFromFee(address account, bool status) external onlyOwner {
        require(account != address(0), "Invalid address");
        isExcludedFromFee[account] = status;
        emit ExcludedFromFee(account, status);
    }

    function setExcludedFromFeeBatch(address[] calldata accounts, bool status) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            require(accounts[i] != address(0), "Invalid address");
            isExcludedFromFee[accounts[i]] = status;
            emit ExcludedFromFee(accounts[i], status);
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Ownable: caller is not the new owner");
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        isExcludedFromFee[owner] = true;
        emit OwnershipTransferred(oldOwner, owner);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0) && to != address(0), "Invalid address");
        require(_balances[from] >= amount, "Insufficient balance");

        uint256 feeAmount;
        bool sell;
        if (!isExcludedFromFee[from] && !isExcludedFromFee[to]) {
            if (isPair[from] && buyFee > 0) {
                feeAmount = amount * buyFee / FEE_BASE;
            } else if (isPair[to] && sellFee > 0) {
                feeAmount = amount * sellFee / FEE_BASE;
                sell = true;
            }
        }

        uint256 receiveAmount = amount - feeAmount;
        unchecked {
            _balances[from] -= amount;
        }
        _balances[to] += receiveAmount;
        emit Transfer(from, to, receiveAmount);

        if (feeAmount > 0) {
            _balances[feeReceiver] += feeAmount;
            emit Transfer(from, feeReceiver, feeAmount);
            emit FeeCollected(from, to, feeAmount, sell);
        }
    }

    function _approve(address tokenOwner, address spender, uint256 amount) internal {
        require(tokenOwner != address(0) && spender != address(0), "Invalid address");
        _allowances[tokenOwner][spender] = amount;
        emit Approval(tokenOwner, spender, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "Invalid address");
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(_balances[from] >= amount, "Insufficient balance");
        unchecked {
            _balances[from] -= amount;
        }
        _totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
